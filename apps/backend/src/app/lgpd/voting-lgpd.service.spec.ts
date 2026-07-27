import { PrismaService } from '../prisma/prisma.service';
import { VotingLgpdService } from './voting-lgpd.service';
import { Prisma } from '@prisma/client';

type PrismaMock = {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock; updateMany: jest.Mock };
  pollImage: { updateMany: jest.Mock };
  pollResponse: { findMany: jest.Mock };
  pollVoter: { findMany: jest.Mock };
  poll: { findMany: jest.Mock };
  cacicElectionSlate: { findMany: jest.Mock };
};

function createPrismaMock(): PrismaMock {
  return {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    pollImage: { updateMany: jest.fn() },
    pollResponse: { findMany: jest.fn() },
    pollVoter: { findMany: jest.fn() },
    poll: { findMany: jest.fn() },
    cacicElectionSlate: { findMany: jest.fn() },
  };
}

describe('VotingLgpdService', () => {
  it('exports only records selected by the requested user ID and omits unrelated identity fields', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'requester',
      preferredUsername: 'requester',
      email: 'requester@example.com',
      name: 'Requester',
      roles: ['voter'],
      permissions: [],
      lastLoginAt: new Date('2026-07-20T12:00:00.000Z'),
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      updatedAt: new Date('2026-07-20T12:00:00.000Z'),
    });
    prisma.pollResponse.findMany.mockResolvedValue([
      {
        id: 'response-1',
        pollId: 'poll-1',
        submittedAt: new Date('2026-07-20T12:00:00.000Z'),
        createdAt: new Date('2026-07-20T12:00:00.000Z'),
        answers: [{ elementId: 'element-1', value: 'answer' }],
      },
    ]);
    prisma.pollVoter.findMany.mockResolvedValue([{ pollId: 'poll-1' }]);
    prisma.poll.findMany.mockResolvedValue([
      {
        id: 'poll-2',
        status: 'PUBLISHED',
        mode: 'REGULAR',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        updatedAt: new Date('2026-07-02T12:00:00.000Z'),
        createdById: 'requester',
        updatedById: 'other-user',
      },
    ]);
    prisma.cacicElectionSlate.findMany.mockResolvedValue([
      {
        id: 'slate-1',
        pollId: 'poll-3',
        status: 'PENDING',
        enabled: true,
        submissionSource: 'PUBLIC',
        submittedAt: new Date('2026-07-01T12:00:00.000Z'),
        reviewedAt: null,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        updatedAt: new Date('2026-07-01T12:00:00.000Z'),
        submittedById: 'requester',
        adminCreatedById: null,
        reviewedById: 'other-user',
      },
    ]);
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.collectUserData({ userId: 'requester', email: 'other@example.com' })).resolves.toMatchObject({
      metadata: { source: 'cacic_voto', userId: 'requester' },
      pollVotes: [{ pollId: 'poll-1' }],
      pollManagement: [{ id: 'poll-2', createdByRequester: true, updatedByRequester: false }],
      cacicElectionSlateActivities: [{ id: 'slate-1', submittedByRequester: true, reviewedByRequester: false }],
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'requester' } }));
    expect(prisma.pollResponse.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'requester' } }));
    expect(prisma.pollVoter.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'requester' } }));
    expect(prisma.poll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ createdById: 'requester' }, { updatedById: 'requester' }] } }),
    );
    expect(prisma.cacicElectionSlate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ submittedById: 'requester' }, { adminCreatedById: 'requester' }, { reviewedById: 'requester' }],
        },
      }),
    );
    expect(prisma.cacicElectionSlate.findMany.mock.calls[0][0].select).not.toHaveProperty('members');
    expect(prisma.pollResponse.findMany.mock.calls[0][0].select).not.toHaveProperty('poll');
    expect(prisma.pollResponse.findMany.mock.calls[0][0].select.answers.select).not.toHaveProperty('elementSnapshot');
  });

  it('anonymizes the requesting user with a stable request-derived ID', async () => {
    const prisma = createPrismaMock();
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.pollImage.updateMany.mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'request-1', userId: 'requester' })).resolves.toMatchObject({
      success: true,
      usersAnonymized: 1,
      relatedRecordsAnonymized: 2,
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'requester' },
      data: {
        id: 'anonymized:request-1',
        preferredUsername: null,
        email: null,
        name: null,
        roles: [],
        permissions: [],
        claims: Prisma.JsonNull,
        lastLoginAt: null,
      },
    });
    expect(prisma.pollImage.updateMany).toHaveBeenCalledWith({
      where: { createdById: 'requester' },
      data: { createdById: 'anonymized:request-1' },
    });
  });

  it('reports a failed deletion when the user does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.pollImage.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'request-1', userId: 'missing' })).resolves.toMatchObject({
      success: false,
      usersAnonymized: 0,
    });
  });
});
