import { BadRequestException, ForbiddenException, Injectable, MessageEvent, NotFoundException, Optional } from '@nestjs/common';
import {
  PollResponseAnswer,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollResultsVoter,
} from '@org/voting-contracts';
import { PollStatus as DbPollStatus, PollVotingStyle as DbPollVotingStyle, Prisma } from '@prisma/client';
import { concatMap, defer, Observable, Subscriber, switchMap } from 'rxjs';
import { SseReplayService } from '../realtime/sse-replay.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminPollAudience,
  assertObserverCanReadElectionPoll,
  resolveAdminPollAudience,
} from './poll-admin-access';
import { requireAuthenticatedVoter } from './poll-auth';
import { PollEligibilityService } from './poll-eligibility.service';
import { PollResultsRealtimeService } from './poll-results-realtime.service';
import { normalizeDirectLinkToken } from './poll-identifiers';
import {
  PollResultResponseRecord,
  PollResultsMetadata,
  PollResultStreamEvent,
} from './poll-records';
import { toPollResultsVoter } from './poll-user-claims';
import {
  isCacicElectionVotingPoll,
  isPollPubliclyVisible,
  publicReadablePollWhere,
} from './poll-visibility';

@Injectable()
export class PollResultsService {
  readonly resultSubscribers = new Map<string, Set<(event: PollResultStreamEvent) => void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: PollEligibilityService,
    @Optional() private readonly realtime?: PollResultsRealtimeService,
    @Optional() private readonly replay?: SseReplayService,
  ) {}

  async getAdminPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    const audience = user ? resolveAdminPollAudience(user) : 'admin';
    const poll = await this.getPollResultsMetadata(id);
    if (audience === 'observer') {
      assertObserverCanReadElectionPoll(poll);
    }

    const responses = this.areAnswersReleased(poll, audience) ? await this.listPollResultResponses(id) : [];
    const responseCount = await this.countPollResponses(id);
    const voters = await this.listPollResultVoters(id, audience);

    return this.toPollResults(poll, responses, audience, { responseCount, voters });
  }

  async exportCacicElectionVoterEnrollments(id: string, user?: AuthenticatedPrincipal): Promise<string> {
    const audience = user ? resolveAdminPollAudience(user) : 'admin';
    const poll = await this.getPollResultsMetadata(id);
    if (audience === 'observer') {
      assertObserverCanReadElectionPoll(poll);
    }

    if (!isCacicElectionVotingPoll(poll)) {
      throw new BadRequestException('Only CACiC election polls can export voter enrollments.');
    }

    if (poll.status !== DbPollStatus.CLOSED) {
      throw new ForbiddenException('CACiC election voter enrollments are available only after the election is closed.');
    }

    const voters = await this.listPollResultVoters(id, audience);
    return voters
      .map((voter) => voter.enrollmentNumber?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
  }

  async getPublicPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    const poll = await this.getPollResultsMetadata(id);
    this.assertPublicResultsVisible(poll);
    await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
    const responses = await this.listPollResultResponses(id);

    return this.toPollResults(poll, responses, 'public', { responseCount: responses.length });
  }

  async getDirectLinkPublicPollResults(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResults> {
    const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
    this.assertPublicResultsVisible(poll);
    requireAuthenticatedVoter(user);
    const responses = await this.listPollResultResponses(poll.id);

    return this.toPollResults(poll, responses, 'public', { responseCount: responses.length });
  }

  streamAdminPollResults(id: string, lastEventId: string | undefined, user?: AuthenticatedPrincipal): Observable<MessageEvent> {
    const audience = user ? resolveAdminPollAudience(user) : 'admin';
    return this.streamPollResults(id, lastEventId, audience, user);
  }

  streamPublicPollResults(id: string, lastEventId: string | undefined, user?: AuthenticatedPrincipal): Observable<MessageEvent> {
    return this.streamPollResults(id, lastEventId, 'public', user);
  }

  streamDirectLinkPublicPollResults(
    directLinkToken: string,
    lastEventId: string | undefined,
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    if (this.realtime && this.replay) {
      const realtime = this.realtime;
      const replay = this.replay;
      return defer(async () => {
        const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
        this.assertPublicResultsVisible(poll);
        requireAuthenticatedVoter(user);
        return poll.id;
      }).pipe(switchMap((pollId) => {
        const scope = realtime.scope('public', pollId);
        const source = realtime.watch(scope).pipe(concatMap(async (event) => {
          const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
          this.assertPublicResultsVisible(poll);
          requireAuthenticatedVoter(user);
          if (poll.id !== pollId) throw new ForbiddenException('Poll access changed.');
          return event;
        }));
        return replay.replay(scope, lastEventId, source);
      }));
    }
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
        this.assertPublicResultsVisible(poll);
        requireAuthenticatedVoter(user);

        const after = 0;
        const catchUp = await this.getPollResultsDelta(poll, after, 'public');
        if (catchUp.responses.length > 0 || catchUp.responseCount !== after) {
          subscriber.next({ data: catchUp });
        }

        unsubscribe = this.subscribeToPollResults(poll.id, (event) => {
          void this.emitDirectLinkPublicPollResultEvent(directLinkToken, user, subscriber, event);
        });
      })().catch((error: unknown) => {
        subscriber.error(error);
      });

      return () => {
        unsubscribe?.();
      };
    });
  }

  async publishPollResultsForResponse(pollId: string, final = false): Promise<void> {
    if (!this.realtime && !this.resultSubscribers.has(pollId)) {
      return;
    }
    const poll = await this.getPollResultsMetadata(pollId);
    const event = {
      admin: { ...(await this.getPollResultsDelta(poll, 0, 'admin')), ...(final ? { final: true } : {}) },
      observer: { ...(await this.getPollResultsDelta(poll, 0, 'observer')), ...(final ? { final: true } : {}) },
      public: { ...(await this.getPollResultsDelta(poll, 0, 'public')), ...(final ? { final: true } : {}) },
    };
    this.publishPollResults(event);
    if (this.realtime) {
      await Promise.all([
        this.realtime.publish(this.realtime.scope('admin', pollId), event.admin),
        this.realtime.publish(this.realtime.scope('observer', pollId), event.observer),
        this.realtime.publish(this.realtime.scope('public', pollId), event.public),
      ]);
    }
  }

  async getPollResultsMetadata(id: string): Promise<PollResultsMetadata> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return poll;
  }

  async getDirectLinkPollResultsMetadata(directLinkToken: string): Promise<PollResultsMetadata> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...publicReadablePollWhere(now),
      },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return poll;
  }

  listPollResultResponses(pollId: string, skip = 0): Promise<PollResultResponseRecord[]> {
    return this.prisma.pollResponse.findMany({
      where: { pollId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      include: {
        answers: {
          select: {
            elementId: true,
            value: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            preferredUsername: true,
            email: true,
            claims: true,
          },
        },
      },
    });
  }

  countPollResponses(pollId: string): Promise<number> {
    return this.prisma.pollResponse.count({ where: { pollId } });
  }

  async listPollResultVoters(
    pollId: string,
    audience: AdminPollAudience = 'admin',
  ): Promise<PollResultsVoter[]> {
    const voters = await this.prisma.pollVoter.findMany({
      where: { pollId },
      orderBy: {
        userId: 'asc',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            preferredUsername: true,
            email: true,
            claims: true,
          },
        },
      },
    });

    return voters.flatMap((voter) =>
      voter.user ? [this.toPollResultsVoter(voter.user, audience)] : [],
    );
  }

  async getPollResultsDelta(
    poll: PollResultsMetadata,
    after: number,
    audience: AdminPollAudience | 'public',
  ): Promise<PollResultsDelta> {
    const responseCount = await this.countPollResponses(poll.id);
    const normalizedAfter = Math.min(Math.max(0, after), responseCount);
    const answersReleased = this.areAnswersReleased(poll, audience);
    const responses = answersReleased ? await this.listPollResultResponses(poll.id, normalizedAfter) : [];
    const voters = audience === 'admin' || audience === 'observer'
      ? await this.listPollResultVoters(poll.id, audience)
      : undefined;

    return {
      pollId: poll.id,
      answersReleased,
      responseCount,
      ...(voters ? { voterCount: voters.length, voters } : {}),
      responses: responses.map((response) => this.toPollResultsResponse(response, audience)),
    };
  }

  toPollResults(
    poll: PollResultsMetadata,
    responses: PollResultResponseRecord[],
    audience: AdminPollAudience | 'public',
    options: {
      responseCount: number;
      voters?: PollResultsVoter[];
    },
  ): PollResults {
    const answersReleased = this.areAnswersReleased(poll, audience);
    return {
      pollId: poll.id,
      anonymous: poll.votingStyle === DbPollVotingStyle.ANONYMOUS,
      answersReleased,
      responseCount: options.responseCount,
      ...((audience === 'admin' || audience === 'observer') && options.voters
        ? { voterCount: options.voters.length, voters: options.voters }
        : {}),
      responses: answersReleased ? responses.map((response) => this.toPollResultsResponse(response, audience)) : [],
    };
  }

  toPollResultsResponse(
    response: PollResultResponseRecord,
    audience: AdminPollAudience | 'public',
  ): PollResultsResponse {
    return {
      id: response.id,
      submittedAt: audience === 'admin' || audience === 'observer' ? response.submittedAt?.toISOString() : undefined,
      voter:
        (audience === 'admin' || audience === 'observer') && response.user
          ? this.toPollResultsVoter(response.user, audience)
          : undefined,
      answers: response.answers.map((answer) => ({
        elementId: answer.elementId,
        value: answer.value as PollResponseAnswer['value'],
      })),
    };
  }

  assertPublicResultsVisible(poll: PollResultsMetadata): void {
    if (!isPollPubliclyVisible(poll, new Date())) {
      throw new NotFoundException('Poll not found.');
    }

    if (!poll.resultsPublic) {
      throw new ForbiddenException('Poll results are not public.');
    }

    if (isCacicElectionVotingPoll(poll)) {
      if (poll.status === DbPollStatus.CLOSED) {
        return;
      }

      throw new ForbiddenException('CACiC election results are released only after the election is closed.');
    }

    if (poll.status === DbPollStatus.CLOSED) {
      return;
    }

    if (poll.status === DbPollStatus.PUBLISHED && poll.resultsLive) {
      return;
    }

    throw new ForbiddenException('Poll results are not public yet.');
  }

  areAnswersReleased(
    poll: Pick<PollResultsMetadata, 'mode' | 'cacicElectionPhase' | 'status' | 'votingStyle'>,
    audience: AdminPollAudience | 'public' = 'public',
  ): boolean {
    if (isCacicElectionVotingPoll(poll)) {
      return poll.status === DbPollStatus.CLOSED;
    }

    return (
      audience !== 'admin' ||
      poll.votingStyle !== DbPollVotingStyle.ANONYMOUS ||
      poll.status === DbPollStatus.CLOSED
    );
  }

  subscribeToPollResults(pollId: string, listener: (event: PollResultStreamEvent) => void): () => void {
    const existingListeners = this.resultSubscribers.get(pollId) ?? new Set<(event: PollResultStreamEvent) => void>();
    existingListeners.add(listener);
    this.resultSubscribers.set(pollId, existingListeners);

    return () => {
      existingListeners.delete(listener);
      if (existingListeners.size === 0) {
        this.resultSubscribers.delete(pollId);
      }
    };
  }

  publishPollResults(event: PollResultStreamEvent): void {
    const listeners = this.resultSubscribers.get(event.admin.pollId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  private streamPollResults(
    id: string,
    lastEventId: string | undefined,
    audience: AdminPollAudience | 'public',
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    if (this.realtime && this.replay) {
      const realtime = this.realtime;
      const replay = this.replay;
      return defer(async () => {
        const poll = await this.getPollResultsMetadata(id);
        if (audience === 'observer') assertObserverCanReadElectionPoll(poll);
        if (audience === 'public') {
          this.assertPublicResultsVisible(poll);
          await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
        }
      }).pipe(switchMap(() => {
        const scope = realtime.scope(audience, id);
        const source = realtime.watch(scope).pipe(concatMap(async (event) => {
          const poll = await this.getPollResultsMetadata(id);
          if (audience === 'observer') assertObserverCanReadElectionPoll(poll);
          if (audience === 'public') {
            this.assertPublicResultsVisible(poll);
            await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
          }
          return event;
        }));
        return replay.replay(scope, lastEventId, source);
      }));
    }
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getPollResultsMetadata(id);
        if (audience === 'observer') {
          assertObserverCanReadElectionPoll(poll);
        }
        if (audience === 'public') {
          this.assertPublicResultsVisible(poll);
          await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
        }

        const after = 0;
        const catchUp = await this.getPollResultsDelta(poll, after, audience);
        if (catchUp.responses.length > 0 || catchUp.responseCount !== after) {
          subscriber.next({ data: catchUp });
        }

        unsubscribe = this.subscribeToPollResults(id, (event) => {
          if (audience === 'admin') {
            subscriber.next({ data: event.admin });
            return;
          }

          if (audience === 'observer') {
            subscriber.next({ data: event.observer });
            return;
          }

          void this.emitPublicPollResultEvent(id, user, subscriber, event);
        });
      })().catch((error: unknown) => {
        subscriber.error(error);
      });

      return () => {
        unsubscribe?.();
      };
    });
  }

  private async emitPublicPollResultEvent(
    id: string,
    user: AuthenticatedPrincipal | undefined,
    subscriber: Subscriber<MessageEvent>,
    event: PollResultStreamEvent,
  ): Promise<void> {
    try {
      if (subscriber.closed) {
        return;
      }

      const poll = await this.getPollResultsMetadata(id);
      this.assertPublicResultsVisible(poll);
      await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));

      if (!subscriber.closed) {
        subscriber.next({ data: event.public });
      }
    } catch (error: unknown) {
      if (!subscriber.closed) {
        subscriber.error(error);
      }
    }
  }

  private async emitDirectLinkPublicPollResultEvent(
    directLinkToken: string,
    user: AuthenticatedPrincipal | undefined,
    subscriber: Subscriber<MessageEvent>,
    event: PollResultStreamEvent,
  ): Promise<void> {
    try {
      if (subscriber.closed) {
        return;
      }

      const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
      this.assertPublicResultsVisible(poll);
      requireAuthenticatedVoter(user);

      if (!subscriber.closed && poll.id === event.public.pollId) {
        subscriber.next({ data: event.public });
      }
    } catch (error: unknown) {
      if (!subscriber.closed) {
        subscriber.error(error);
      }
    }
  }

  private toPollResultsVoter(
    user: {
      id: string;
      name: string | null;
      preferredUsername: string | null;
      email: string | null;
      claims: Prisma.JsonValue | null;
    },
    audience: AdminPollAudience,
  ): PollResultsVoter {
    const voter = toPollResultsVoter(user);
    if (audience === 'admin') {
      return voter;
    }

    return {
      userId: voter.enrollmentNumber ? `enrollment:${voter.enrollmentNumber}` : 'redacted',
      ...(voter.enrollmentNumber ? { enrollmentNumber: voter.enrollmentNumber } : {}),
    };
  }
}
