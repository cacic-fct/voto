import { ForbiddenException } from '@nestjs/common';
import { PollResultsService } from './poll-results.service';
import { PollVotingStyle as DbPollVotingStyle, PollStatus as DbPollStatus } from '@prisma/client';

describe('PollResultsService public privacy contracts', () => {
  const metadata = {
    id: 'poll-1',
    status: DbPollStatus.CLOSED,
    mode: 'REGULAR',
    cacicElectionPhase: null,
    votingStyle: DbPollVotingStyle.SECRET,
    voterEligibilitySource: 'AUTHENTICATED_USERS',
    requireVerifiedUnespRole: false,
    linkedEventId: null,
    resultsPublic: true,
    resultsLive: true,
    visibleFrom: null,
    votingStartsAt: null,
    votingEndsAt: null,
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  } as never;
  const user = {
    sub: 'voter-1',
    claims: {},
    permissions: [],
    roles: [],
    scopes: [],
    oidcScopes: [],
    token: 'token',
    roleSet: new Set<string>(),
    permissionSet: new Set<string>(),
  } as never;

  function createService() {
    const prisma = {
      poll: { findUnique: jest.fn().mockResolvedValue(metadata), findFirst: jest.fn().mockResolvedValue(metadata) },
      pollResponse: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{
          id: 'response-secret',
          pollId: 'poll-1',
          submittedAt: new Date('2026-08-02T00:00:00.000Z'),
          createdAt: new Date('2026-08-02T00:00:00.000Z'),
          answers: [{ elementId: 'question-1', value: 'option-a', elementSnapshot: null }],
          user: { id: 'voter-1', name: 'Ada', preferredUsername: 'ada', email: 'ada@example.com', claims: {} },
        }]),
      },
      pollElement: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'question-1',
          type: 'SINGLE_CHOICE',
          title: 'Escolha',
          description: null,
          required: true,
          settings: null,
          position: 0,
          options: [{ id: 'option-a', label: 'A', description: null, position: 0 }],
        }]),
      },
      pollVoter: { findMany: jest.fn().mockResolvedValue([{ user: { id: 'voter-1', name: 'Ada', preferredUsername: 'ada', email: 'ada@example.com', claims: {} } }]) },
    };
    const eligibility = { ensureVotingAllowed: jest.fn().mockResolvedValue(undefined) };
    const realtime = {
      scope: jest.fn((_audience: string, pollId: string) => `scope:${pollId}`),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    return {
      prisma,
      realtime,
      service: new PollResultsService(
        prisma as never,
        eligibility as never,
        realtime as never,
        {} as never,
      ),
    };
  }

  it('returns aggregate-only secret results with physically absent ballot fields', async () => {
    const { service, prisma } = createService();

    const result = await service.getPublicPollResults('poll-1', user);

    expect(result.responses).toEqual([]);
    expect(result.aggregates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        elementId: 'question-1',
        answeredCount: 1,
        buckets: [{ key: 'option-a', count: 1 }],
      }),
    ]));
    expect(JSON.stringify(result)).not.toContain('response-secret');
    expect(JSON.stringify(result)).not.toContain('ada@example.com');
    expect(prisma.pollResponse.findMany).toHaveBeenCalled();
  });

  it('publishes partially-secret participants separately and never links them to answers', async () => {
    const { service } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      votingStyle: DbPollVotingStyle.PARTIALLY_SECRET,
    });

    const result = await service.getPublicPollResults('poll-1', user);

    expect(result.responses).toEqual([]);
    expect(result.voters).toEqual([{ userId: expect.stringMatching(/^participant:/), name: 'Ada' }]);
    expect(result.voters?.[0]).not.toHaveProperty('email');
    expect(result.voters?.[0]).not.toHaveProperty('preferredUsername');
  });

  it('keeps public-style row-level responses available while omitting participant linkage', async () => {
    const { service } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      votingStyle: DbPollVotingStyle.PUBLIC,
    });

    const result = await service.getPublicPollResults('poll-1', user);

    expect(result.responses).toEqual([expect.objectContaining({ id: 'response-secret', voter: undefined })]);
    expect(result.aggregates).toBeUndefined();
  });

  it('keeps anonymous results aggregate-only in the same server contract matrix', async () => {
    const { service } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      votingStyle: DbPollVotingStyle.ANONYMOUS,
    });

    const result = await service.getPublicPollResults('poll-1', user);

    expect(result.responses).toEqual([]);
    expect(result.aggregates).toEqual(expect.any(Array));
    expect(JSON.stringify(result)).not.toContain('response-secret');
    expect(JSON.stringify(result)).not.toContain('ada@example.com');
  });

  it('rejects live result reads for non-public voting styles to prevent timing correlation', async () => {
    const { service } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      status: DbPollStatus.PUBLISHED,
      resultsLive: true,
    });

    await expect(service.getPublicPollResults('poll-1', user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('publishes a bounded refresh marker instead of rebuilding full snapshots per vote', async () => {
    const { service, realtime } = createService();
    realtime.scope.mockReturnValue('public:scope');

    await service.publishPollResultsForResponse('poll-1');

    expect(realtime.publish).toHaveBeenCalledWith('public:scope', expect.objectContaining({
      pollId: 'poll-1',
      refreshRequired: true,
      responses: [],
    }));
  });

  it.each([
    DbPollVotingStyle.SECRET,
    DbPollVotingStyle.ANONYMOUS,
    DbPollVotingStyle.PARTIALLY_SECRET,
  ])('does not publish live public events for %s results', async (votingStyle) => {
    const { service } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      status: DbPollStatus.PUBLISHED,
      votingStyle,
      resultsLive: true,
    });
    const realtime = {
      scope: jest.fn((audience: string) => `${audience}:scope`),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    (service as never as { realtime: unknown }).realtime = realtime;

    await service.publishPollResultsForResponse('poll-1');

    expect(realtime.publish).not.toHaveBeenCalledWith('public:scope', expect.anything());
  });
});
