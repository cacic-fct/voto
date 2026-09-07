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
  };
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

  it('keeps grid aggregate buckets distinct when row and column identifiers contain colons', async () => {
    const { service, prisma } = createService();
    (service as never as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      ...metadata,
      votingStyle: DbPollVotingStyle.ANONYMOUS,
    });
    prisma.pollElement.findMany.mockResolvedValue([{
      id: 'grid-1',
      type: 'SINGLE_SELECTION_GRID',
      title: 'Grade',
      description: null,
      required: false,
      settings: {
        grid: {
          rows: [
            { id: 'a:b', label: 'Linha A:B', description: null, position: 0 },
            { id: 'a', label: 'Linha A', description: null, position: 1 },
          ],
          columns: [
            { id: 'c', label: 'Coluna C', description: null, position: 0 },
            { id: 'b:c', label: 'Coluna B:C', description: null, position: 1 },
          ],
        },
      },
      position: 0,
      options: [],
    }]);
    prisma.pollResponse.count.mockResolvedValue(2);
    prisma.pollResponse.findMany.mockResolvedValue([
      {
        id: 'response-1',
        pollId: 'poll-1',
        submittedAt: null,
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        answers: [{ elementId: 'grid-1', value: { 'a:b': 'c' }, elementSnapshot: null }],
        user: null,
      },
      {
        id: 'response-2',
        pollId: 'poll-1',
        submittedAt: null,
        createdAt: new Date('2026-08-02T00:00:01.000Z'),
        answers: [{ elementId: 'grid-1', value: { a: 'b:c' }, elementSnapshot: null }],
        user: null,
      },
    ]);

    const result = await service.getPublicPollResults('poll-1', user);
    const buckets = result.aggregates?.[0]?.buckets ?? [];
    expect(buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowId: 'a:b', columnId: 'c', count: 1 }),
      expect.objectContaining({ rowId: 'a', columnId: 'b:c', count: 1 }),
    ]));
    expect(buckets).toHaveLength(2);
  });

  it('releases anonymous free-text answers without chronological ordering after close', async () => {
    const { service, prisma } = createService();
    const open = { ...metadata, votingStyle: DbPollVotingStyle.ANONYMOUS, status: DbPollStatus.PUBLISHED };
    const closed = { ...open, status: DbPollStatus.CLOSED };
    (service as unknown as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn()
      .mockResolvedValueOnce(open).mockResolvedValueOnce(closed);
    const chronological = ['c', 'a', 'b'].map((id, index) => ({
      id, pollId: 'poll-1', submittedAt: null,
      createdAt: new Date(Date.UTC(2026, 7, 2, 0, index)),
      answers: [{ elementId: 'question-1', value: `Feedback ${id}`, elementSnapshot: null }], user: null,
    }));
    prisma.pollResponse.count.mockResolvedValue(3);
    prisma.pollResponse.findMany.mockResolvedValue(chronological);
    const openResult = await service.getAdminPollResults('poll-1');
    const closedResult = await service.getAdminPollResults('poll-1');
    expect(openResult).toMatchObject({ answersReleased: false, responses: [] });
    expect(closedResult.responses.map((response) => response.id)).toEqual(['a', 'b', 'c']);
    expect(closedResult.responses.map((response) => response.answers[0].value)).toEqual(['Feedback a', 'Feedback b', 'Feedback c']);
    expect(JSON.stringify(closedResult.responses)).not.toContain('submittedAt');
    expect(JSON.stringify(closedResult.responses)).not.toContain('createdAt');
    expect(JSON.stringify(closedResult.responses)).not.toContain('voter');
    expect(prisma.pollResponse.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ id: 'asc' }], skip: 0 }));
    await service.getPollResultsDelta(closed, 1, 'admin');
    expect(prisma.pollResponse.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ id: 'asc' }], skip: 1 }));
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
