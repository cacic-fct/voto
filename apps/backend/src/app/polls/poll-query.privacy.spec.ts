import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PollQueryService } from './poll-query.service';

describe('PollQueryService public catalog authorization', () => {
  const poll = {
    id: 'restricted-poll',
    title: 'Restrito',
    description: 'Dados sensíveis',
    status: 'PUBLISHED',
    mode: 'REGULAR',
    cacicElectionPhase: null,
    votingStyle: 'SECRET',
    voterEligibilitySource: 'ENROLLMENT_LIST',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: true,
    resultsLive: true,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    linkedEventId: null,
    linkedEventName: null,
    linkedEventStartDate: null,
    linkedEventEndDate: null,
    linkedEventLocationDescription: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    visibleFrom: null,
    votingStartsAt: null,
    votingEndsAt: null,
    _count: { elements: 1, responses: 2 },
  };
  const principal = { sub: 'user-1', claims: {} } as never;

  it('omits restricted catalog metadata when eligibility denies the requester', async () => {
    const prisma = { poll: { findMany: jest.fn().mockResolvedValue([poll]) } };
    const eligibility = { ensureVotingAllowed: jest.fn().mockRejectedValue(new ForbiddenException()) };
    const service = new PollQueryService(prisma as never, {} as never, eligibility as never);

    await expect(service.listPublicPolls(principal)).resolves.toEqual([]);
    expect(eligibility.ensureVotingAllowed).toHaveBeenCalled();
  });

  it('returns public catalog metadata only after the requester passes eligibility', async () => {
    const prisma = { poll: { findMany: jest.fn().mockResolvedValue([poll]) } };
    const eligibility = { ensureVotingAllowed: jest.fn().mockResolvedValue(undefined) };
    const service = new PollQueryService(prisma as never, {} as never, eligibility as never);

    await expect(service.listPublicPolls(principal)).resolves.toEqual([
      expect.objectContaining({ id: 'restricted-poll', title: 'Restrito', responseCount: 2 }),
    ]);
  });
  it('omits unavailable restricted entries while retaining independently eligible polls and coalescing checks', async () => {
    const restricted = { ...poll, id: 'outage-a', voterEligibilitySource: 'EVENT_ATTENDANCE', linkedEventId: 'event-1' };
    const publicPoll = { ...poll, id: 'available', voterEligibilitySource: 'AUTHENTICATED_USERS' };
    const prisma = { poll: { findMany: jest.fn().mockResolvedValue([
      restricted, { ...restricted, id: 'outage-b' }, publicPoll,
    ]) } };
    const eligibility = { ensureVotingAllowed: jest.fn(async (item: { id: string }) => {
      if (item.id !== 'available') throw new ServiceUnavailableException('Attendance unavailable');
    }) };
    const service = new PollQueryService(prisma as never, {} as never, eligibility as never);
    await expect(service.listPublicPolls(principal)).resolves.toEqual([
      expect.objectContaining({ id: 'available' }),
    ]);
    expect(eligibility.ensureVotingAllowed).toHaveBeenCalledTimes(2);
  });

  it('does not disguise an unexpected programming or persistence failure as an eligibility outage', async () => {
    const prisma = { poll: { findMany: jest.fn().mockResolvedValue([poll]) } };
    const eligibility = { ensureVotingAllowed: jest.fn().mockRejectedValue(new Error('unexpected')) };
    const service = new PollQueryService(prisma as never, {} as never, eligibility as never);
    await expect(service.listPublicPolls(principal)).rejects.toThrow('unexpected');
  });

});
