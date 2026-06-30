import { ForbiddenException, Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import { PollResults, PollResultsDelta, PollResultsResponse } from '@org/voting-contracts';
import { PollStatus as DbPollStatus, PollVotingStyle as DbPollVotingStyle } from '@prisma/client';
import { Observable, Subscriber } from 'rxjs';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { requireAuthenticatedVoter } from './poll-auth';
import { PollEligibilityService } from './poll-eligibility.service';
import { normalizeDirectLinkToken } from './poll-identifiers';
import {
  PollResultResponseRecord,
  PollResultsMetadata,
  PollResultStreamEvent,
} from './poll-records';
import { toContractPollResponseAnswer } from './poll-response.mapper';
import { toPollResultsVoter } from './poll-user-claims';

@Injectable()
export class PollResultsService {
  readonly resultSubscribers = new Map<string, Set<(event: PollResultStreamEvent) => void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: PollEligibilityService,
  ) {}

  async getAdminPollResults(id: string): Promise<PollResults> {
    const poll = await this.getPollResultsMetadata(id);
    const responses = await this.listPollResultResponses(id);

    return this.toPollResults(poll, responses, 'admin');
  }

  async getPublicPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    const poll = await this.getPollResultsMetadata(id);
    this.assertPublicResultsVisible(poll);
    await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
    const responses = await this.listPollResultResponses(id);

    return this.toPollResults(poll, responses, 'public');
  }

  async getDirectLinkPublicPollResults(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResults> {
    const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
    this.assertPublicResultsVisible(poll);
    requireAuthenticatedVoter(user);
    const responses = await this.listPollResultResponses(poll.id);

    return this.toPollResults(poll, responses, 'public');
  }

  streamAdminPollResults(id: string, after: number): Observable<MessageEvent> {
    return this.streamPollResults(id, after, 'admin');
  }

  streamPublicPollResults(id: string, after: number, user?: AuthenticatedPrincipal): Observable<MessageEvent> {
    return this.streamPollResults(id, after, 'public', user);
  }

  streamDirectLinkPublicPollResults(
    directLinkToken: string,
    after: number,
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
        this.assertPublicResultsVisible(poll);
        requireAuthenticatedVoter(user);

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

  async publishPollResultsForResponse(
    pollId: string,
    response: PollResultResponseRecord,
  ): Promise<void> {
    if (!this.resultSubscribers.has(pollId)) {
      return;
    }

    const responseCount = await this.prisma.pollResponse.count({ where: { pollId } });
    this.publishPollResults({
      admin: {
        pollId,
        responseCount,
        responses: [this.toPollResultsResponse(response, 'admin')],
      },
      public: {
        pollId,
        responseCount,
        responses: [this.toPollResultsResponse(response, 'public')],
      },
    });
  }

  async getPollResultsMetadata(id: string): Promise<PollResultsMetadata> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return poll;
  }

  async getDirectLinkPollResultsMetadata(directLinkToken: string): Promise<PollResultsMetadata> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      select: {
        id: true,
        status: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
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
          include: {
            element: {
              include: {
                options: {
                  orderBy: { position: 'asc' },
                },
              },
            },
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

  async getPollResultsDelta(
    poll: PollResultsMetadata,
    after: number,
    audience: 'admin' | 'public',
  ): Promise<PollResultsDelta> {
    const responseCount = await this.prisma.pollResponse.count({ where: { pollId: poll.id } });
    const normalizedAfter = Math.min(Math.max(0, after), responseCount);
    const responses = await this.listPollResultResponses(poll.id, normalizedAfter);

    return {
      pollId: poll.id,
      responseCount,
      responses: responses.map((response) => this.toPollResultsResponse(response, audience)),
    };
  }

  toPollResults(
    poll: PollResultsMetadata,
    responses: PollResultResponseRecord[],
    audience: 'admin' | 'public',
  ): PollResults {
    return {
      pollId: poll.id,
      anonymous: poll.votingStyle === DbPollVotingStyle.ANONYMOUS,
      responseCount: responses.length,
      responses: responses.map((response) => this.toPollResultsResponse(response, audience)),
    };
  }

  toPollResultsResponse(
    response: PollResultResponseRecord,
    audience: 'admin' | 'public',
  ): PollResultsResponse {
    return {
      id: response.id,
      submittedAt: audience === 'admin' ? response.submittedAt?.toISOString() : undefined,
      voter: audience === 'admin' && response.user ? toPollResultsVoter(response.user) : undefined,
      answers: response.answers.map((answer) => toContractPollResponseAnswer(answer)),
    };
  }

  assertPublicResultsVisible(poll: PollResultsMetadata): void {
    if (!poll.resultsPublic) {
      throw new ForbiddenException('Poll results are not public.');
    }

    if (poll.status === DbPollStatus.CLOSED) {
      return;
    }

    if (poll.status === DbPollStatus.PUBLISHED && poll.resultsLive) {
      return;
    }

    throw new ForbiddenException('Poll results are not public yet.');
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
    after: number,
    audience: 'admin' | 'public',
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getPollResultsMetadata(id);
        if (audience === 'public') {
          this.assertPublicResultsVisible(poll);
          await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
        }

        const catchUp = await this.getPollResultsDelta(poll, after, audience);
        if (catchUp.responses.length > 0 || catchUp.responseCount !== after) {
          subscriber.next({ data: catchUp });
        }

        unsubscribe = this.subscribeToPollResults(id, (event) => {
          if (audience === 'admin') {
            subscriber.next({ data: event.admin });
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
}
