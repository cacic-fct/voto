import { BadRequestException, ForbiddenException, Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import {
  PollElement,
  PollResultsAggregate,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollResultsVoter,
} from '@org/voting-contracts';
import {
  PollStatus as DbPollStatus,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { concatMap, defer, Observable, Subscriber, switchMap, takeUntil, timer } from 'rxjs';
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
import {
  externalPollElementId,
  externalPollOptionId,
  normalizeDirectLinkToken,
} from './poll-identifiers';
import {
  PollResultResponseRecord,
  PollResultsMetadata,
  PollResultStreamEvent,
} from './poll-records';
import { toContractPollResponseAnswer } from './poll-response.mapper';
import { toContractElement } from './poll-contract.mapper';
import { toPollResultsVoter } from './poll-user-claims';
import {
  isCacicElectionVotingPoll,
  isPollPubliclyVisible,
  publicReadablePollWhere,
} from './poll-visibility';

const MAX_RESULT_STREAM_LIFETIME_MS = 15 * 60 * 1000;

@Injectable()
export class PollResultsService {
  readonly resultSubscribers = new Map<string, Set<(event: PollResultStreamEvent) => void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: PollEligibilityService,
    private readonly realtime: PollResultsRealtimeService,
    private readonly replay: SseReplayService,
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
    const responses = this.isPublicRowLevelResults(poll)
      ? await this.listPollResultResponses(id)
      : [];
    const responseCount = await this.countPollResponses(id);
    const aggregates = this.isPublicRowLevelResults(poll)
      ? undefined
      : await this.buildPollResultAggregates(id);
    const voters = poll.votingStyle === DbPollVotingStyle.PARTIALLY_SECRET
      ? await this.listPublicPollResultParticipants(id)
      : undefined;

    return this.toPollResults(poll, responses, 'public', {
      responseCount,
      ...(aggregates ? { aggregates } : {}),
      ...(voters ? { voters } : {}),
    });
  }

  async getDirectLinkPublicPollResults(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResults> {
    const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
    this.assertPublicResultsVisible(poll);
    requireAuthenticatedVoter(user);
    const responses = this.isPublicRowLevelResults(poll)
      ? await this.listPollResultResponses(poll.id)
      : [];
    const responseCount = await this.countPollResponses(poll.id);
    const aggregates = this.isPublicRowLevelResults(poll)
      ? undefined
      : await this.buildPollResultAggregates(poll.id);
    const voters = poll.votingStyle === DbPollVotingStyle.PARTIALLY_SECRET
      ? await this.listPublicPollResultParticipants(poll.id)
      : undefined;

    return this.toPollResults(poll, responses, 'public', {
      responseCount,
      ...(aggregates ? { aggregates } : {}),
      ...(voters ? { voters } : {}),
    });
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
        return replay
          .replay(scope, lastEventId, source)
          .pipe(takeUntil(timer(MAX_RESULT_STREAM_LIFETIME_MS)));
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
    }).pipe(takeUntil(timer(MAX_RESULT_STREAM_LIFETIME_MS)));
  }

  async publishPollResultsForResponse(pollId: string, final = false): Promise<void> {
    if (!this.realtime && !this.resultSubscribers.has(pollId)) {
      return;
    }
    const poll = await this.getPollResultsMetadata(pollId);
    const responseCount = await this.countPollResponses(pollId);
    const buildRefreshDelta = (audience: AdminPollAudience | 'public'): PollResultsDelta => ({
      pollId,
      answersReleased: this.areAnswersReleased(poll, audience),
      responseCount,
      refreshRequired: true,
      ...(final ? { final: true } : {}),
      responses: [],
    });
    const event = {
      // Full snapshots are still available through the HTTP contract and the
      // replay catch-up path. Per-vote publication only carries a bounded
      // invalidation marker, preventing O(N^2) read/serialize/replay work as
      // the response table grows.
      admin: buildRefreshDelta('admin'),
      observer: buildRefreshDelta('observer'),
      public: buildRefreshDelta('public'),
    };
    this.publishPollResults(event);
    if (this.realtime) {
      const publications = [
        this.realtime.publish(this.realtime.scope('admin', pollId), event.admin),
        this.realtime.publish(this.realtime.scope('observer', pollId), event.observer),
      ];
      if (poll.status !== DbPollStatus.PUBLISHED || poll.votingStyle === DbPollVotingStyle.PUBLIC) {
        publications.push(this.realtime.publish(this.realtime.scope('public', pollId), event.public));
      }
      await Promise.all(publications);
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

  async listPollResultResponses(pollId: string, skip = 0): Promise<PollResultResponseRecord[]> {
    const responses = await this.prisma.pollResponse.findMany({
      where: { pollId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      include: {
        answers: {
          select: {
            elementId: true,
            value: true,
            elementSnapshot: true,
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
    return responses ?? [];
  }

  async countPollResponses(pollId: string): Promise<number> {
    const count = await this.prisma.pollResponse.count({ where: { pollId } });
    return typeof count === 'number' ? count : 0;
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

  /**
   * Partially-secret polls may publish who participated, but that list must
   * remain a separate, intentionally minimal collection. It is never joined
   * to a response and uses a poll-scoped opaque reference instead of a raw
   * account-manager user id.
   */
  async listPublicPollResultParticipants(pollId: string): Promise<PollResultsVoter[]> {
    const voters = await this.prisma.pollVoter.findMany({
      where: { pollId },
      orderBy: { userId: 'asc' },
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

    return voters.flatMap((voter) => {
      if (!voter.user) {
        return [];
      }

      const participant = this.toPollResultsVoter(voter.user, 'publicParticipants', pollId);
      return [participant];
    });
  }

  async getPollResultsDelta(
    poll: PollResultsMetadata,
    after: number,
    audience: AdminPollAudience | 'public',
  ): Promise<PollResultsDelta> {
    const responseCount = await this.countPollResponses(poll.id);
    const normalizedAfter = Math.min(Math.max(0, after), responseCount);
    const answersReleased = this.areAnswersReleased(poll, audience);
    const publicRowLevel = audience === 'public' && this.isPublicRowLevelResults(poll);
    const responses = answersReleased && (audience !== 'public' || publicRowLevel)
      ? await this.listPollResultResponses(poll.id, normalizedAfter)
      : [];
    const aggregates = answersReleased && audience === 'public' && !publicRowLevel
      ? await this.buildPollResultAggregates(poll.id)
      : undefined;
    const voters = audience === 'admin' || audience === 'observer'
      ? await this.listPollResultVoters(poll.id, audience)
      : poll.votingStyle === DbPollVotingStyle.PARTIALLY_SECRET
        ? await this.listPublicPollResultParticipants(poll.id)
        : undefined;

    return {
      pollId: poll.id,
      answersReleased,
      responseCount,
      ...(voters ? { voterCount: voters.length, voters } : {}),
      ...(aggregates ? { aggregates } : {}),
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
      aggregates?: PollResultsAggregate[];
    },
  ): PollResults {
    const answersReleased = this.areAnswersReleased(poll, audience);
    const publicRowLevel = audience === 'public' && this.isPublicRowLevelResults(poll);
    return {
      pollId: poll.id,
      anonymous: poll.votingStyle === DbPollVotingStyle.ANONYMOUS,
      answersReleased,
      responseCount: options.responseCount,
      ...((audience === 'admin' || audience === 'observer' || poll.votingStyle === DbPollVotingStyle.PARTIALLY_SECRET) && options.voters
        ? { voterCount: options.voters.length, voters: options.voters }
        : {}),
      ...(audience === 'public' && !publicRowLevel && options.aggregates
        ? { aggregates: options.aggregates }
        : {}),
      responses: answersReleased && (audience !== 'public' || publicRowLevel)
        ? responses.map((response) => this.toPollResultsResponse(response, audience))
        : [],
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
        ...toContractPollResponseAnswer(answer, response.pollId),
      })),
    };
  }

  private isPublicRowLevelResults(
    poll: Pick<PollResultsMetadata, 'votingStyle'>,
  ): boolean {
    return poll.votingStyle === DbPollVotingStyle.PUBLIC;
  }

  private async buildPollResultAggregates(pollId: string): Promise<PollResultsAggregate[]> {
    const [rawElements, responses] = await Promise.all([
      this.prisma.pollElement.findMany({
        where: { pollId, retiredAt: null },
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          required: true,
          settings: true,
          position: true,
          options: {
            select: { id: true, label: true, description: true, position: true },
          },
        },
      }),
      this.listPollResultResponses(pollId),
    ]);
    const elements = rawElements ?? [];
    const currentElements = new Map<string, PollElement>();
    const versions = new Map<string, { element: PollElement; answeredCount: number; buckets: Map<string, number> }>();

    for (const element of elements) {
      const snapshot = toContractElement(element, [], {}, pollId);
      currentElements.set(element.id, snapshot);
      if (snapshot.type !== 'section' && snapshot.type !== 'statement') {
        versions.set(this.aggregateVersionKey(snapshot), {
          element: snapshot,
          answeredCount: 0,
          buckets: new Map<string, number>(),
        });
      }
    }

    for (const response of responses) {
      for (const answer of response.answers) {
        const currentElement = currentElements.get(answer.elementId);
        const element = this.readHistoricalElementSnapshot(answer.elementSnapshot ?? null, pollId) ?? currentElement;
        if (!element || element.type === 'section' || element.type === 'statement') {
          continue;
        }

        const versionKey = this.aggregateVersionKey(element);
        const aggregate = versions.get(versionKey) ?? {
          element,
          answeredCount: 0,
          buckets: new Map<string, number>(),
        };
        if (this.isNonEmptyResultValue(answer.value)) {
          aggregate.answeredCount += 1;
          if (
            element.type !== 'shortText' &&
            element.type !== 'longText' &&
            element.type !== 'date' &&
            element.type !== 'time'
          ) {
            for (const key of this.aggregateValueKeys(element, answer.value, answer.elementId)) {
              aggregate.buckets.set(key, (aggregate.buckets.get(key) ?? 0) + 1);
            }
          }
        }
        versions.set(versionKey, aggregate);
      }
    }

    return [...versions.values()].map((aggregate) => {
      const buckets = [...aggregate.buckets.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((first, second) => second.count - first.count || first.key.localeCompare(second.key));
      return {
        elementId: aggregate.element.id,
        versionKey: this.aggregateVersionKey(aggregate.element),
        elementSnapshot: aggregate.element,
        answeredCount: aggregate.answeredCount,
        ...(buckets.length > 0 ? { buckets } : {}),
      };
    });
  }

  private aggregateValueKeys(element: PollElement, value: Prisma.JsonValue, storedElementId: string): string[] {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [this.decodeAggregateOptionKey(storedElementId, String(value))];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
          ? [this.decodeAggregateOptionKey(storedElementId, String(item))]
          : [],
      );
    }

    if (!this.isJsonRecord(value)) {
      return [];
    }

    if (element.type === 'scheduling') {
      return typeof value.slotId === 'string' && value.slotId.trim() ? [value.slotId] : [];
    }

    if (
      element.type === 'singleSelectionGrid' ||
      element.type === 'multipleSelectionGrid'
    ) {
      return Object.entries(value).flatMap(([rowId, rowValue]) => {
        const values = Array.isArray(rowValue) ? rowValue : [rowValue];
        return values.flatMap((columnId) =>
          typeof columnId === 'string' || typeof columnId === 'number'
            ? [`${rowId}:${this.decodeAggregateOptionKey(storedElementId, String(columnId))}`]
            : [],
        );
      });
    }

    return [];
  }

  private decodeAggregateOptionKey(elementId: string, key: string): string {
    return externalPollOptionId(elementId, key);
  }

  private aggregateVersionKey(element: Pick<PollElement, 'id' | 'type' | 'title' | 'description' | 'required' | 'options' | 'settings'>): string {
    return createHash('sha256')
      .update(JSON.stringify({
        id: element.id,
        type: element.type,
        title: element.title,
        description: element.description ?? null,
        required: element.required,
        options: element.options,
        settings: element.settings ?? null,
      }))
      .digest('base64url')
      .slice(0, 22);
  }

  private readHistoricalElementSnapshot(value: Prisma.JsonValue | null, pollId: string): PollElement | undefined {
    if (!this.isJsonRecord(value)) {
      return undefined;
    }

    const id = typeof value.id === 'string' ? value.id : '';
    const type = typeof value.type === 'string' ? value.type : '';
    const title = typeof value.title === 'string' ? value.title : '';
    if (!id || !type || !title) {
      return undefined;
    }

    const options = Array.isArray(value.options)
      ? value.options.flatMap((option) => {
        if (!this.isJsonRecord(option) || typeof option.id !== 'string' || typeof option.label !== 'string') {
          return [];
        }
        return [{
          id: externalPollOptionId(id, option.id),
          label: option.label,
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        }];
      })
      : [];

    return {
      id: externalPollElementId(pollId, id),
      type: type as PollElement['type'],
      title,
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      required: value.required === true,
      options,
      ...(this.isJsonRecord(value.settings ?? null) ? { settings: value.settings as PollElement['settings'] } : {}),
    };
  }

  private isNonEmptyResultValue(value: Prisma.JsonValue): boolean {
    return !(
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (this.isJsonRecord(value) && Object.keys(value).length === 0)
    );
  }

  private isJsonRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    // Only explicitly public ballots may be published while voting is live.
    // For secret, anonymous, and partially-secret polls a participant list or
    // aggregate delta can be correlated with the latest vote by timing.
    if (
      poll.status === DbPollStatus.PUBLISHED &&
      poll.resultsLive &&
      poll.votingStyle === DbPollVotingStyle.PUBLIC
    ) {
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
    audience: AdminPollAudience | 'publicParticipants',
    pollId?: string,
  ): PollResultsVoter {
    const voter = toPollResultsVoter(user);
    if (audience === 'publicParticipants') {
      return {
        userId: `participant:${this.participantReference(pollId ?? '', voter.userId)}`,
        ...(voter.name ? { name: voter.name } : {}),
      };
    }

    if (audience === 'admin') {
      return voter;
    }

    return {
      userId: voter.enrollmentNumber ? `enrollment:${voter.enrollmentNumber}` : 'redacted',
      ...(voter.enrollmentNumber ? { enrollmentNumber: voter.enrollmentNumber } : {}),
    };
  }

  private participantReference(pollId: string, userId: string): string {
    return createHash('sha256').update(`${pollId}:${userId}`).digest('base64url').slice(0, 22);
  }
}
