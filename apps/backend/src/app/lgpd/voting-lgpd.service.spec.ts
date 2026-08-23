import { PrismaService } from '../prisma/prisma.service';
import { VotingLgpdService } from './voting-lgpd.service';
import { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';

type PrismaMock = {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock; updateMany: jest.Mock; create: jest.Mock; delete: jest.Mock };
  pollImage: { updateMany: jest.Mock };
  pollResponse: { findMany: jest.Mock; updateMany: jest.Mock };
  pollVoter: { findMany: jest.Mock; updateMany: jest.Mock };
  poll: { findMany: jest.Mock; updateMany: jest.Mock };
  pollEligibilityEnrollment: { findMany: jest.Mock; updateMany: jest.Mock };
  cacicElectionSlate: { findMany: jest.Mock; updateMany: jest.Mock };
  cacicElectionSlateMember: { findMany: jest.Mock };
};

function createPrismaMock(): PrismaMock {
  return {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    pollImage: { updateMany: jest.fn() },
    pollResponse: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pollVoter: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    poll: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pollEligibilityEnrollment: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cacicElectionSlate: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cacicElectionSlateMember: { findMany: jest.fn() },
  };
}

describe('VotingLgpdService', () => {
  it('fails closed until durable LGPD scheduling state is available', async () => {
    const service = new VotingLgpdService(createPrismaMock() as unknown as PrismaService);

    await expect(service.scheduleDeletion({ requestId: 'request-1', userId: 'requester' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.cancelDeletion({ requestId: 'request-1', userId: 'requester' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

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
      claims: { enrollmentNumber: '24123456' },
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
    prisma.pollEligibilityEnrollment.findMany.mockResolvedValue([
      { pollId: 'poll-4', enrollmentNumber: '24123456', createdAt: new Date('2026-07-01T12:00:00.000Z') },
    ]);
    prisma.cacicElectionSlateMember.findMany.mockResolvedValue([]);
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.collectUserData({ userId: 'requester', email: 'other@example.com' })).resolves.toMatchObject({
      metadata: { source: 'cacic_voto', userId: 'requester' },
      pollVotes: [{ pollId: 'poll-1' }],
      pollManagement: [{ id: 'poll-2', createdByRequester: true, updatedByRequester: false }],
      cacicElectionSlateActivities: [{ id: 'slate-1', submittedByRequester: true, reviewedByRequester: false }],
      unlinkedEligibilityEnrollments: [{ pollId: 'poll-4', enrollmentNumber: '24123456' }],
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
    expect(prisma.cacicElectionSlateMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { identifierType: 'EMAIL', identifierValue: 'requester@example.com' },
    }));
    expect(prisma.cacicElectionSlate.findMany.mock.calls[0][0].select).not.toHaveProperty('members');
    expect(prisma.pollResponse.findMany.mock.calls[0][0].select).not.toHaveProperty('poll');
    expect(prisma.pollResponse.findMany.mock.calls[0][0].select.answers.select).not.toHaveProperty('elementSnapshot');
  });

  it('anonymizes the requesting user with a fixed-length subject/request HMAC', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.user.create.mockResolvedValue({ id: 'anonymized' });
    prisma.user.delete.mockResolvedValue({ id: 'requester' });
    prisma.pollImage.updateMany.mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'request-1', userId: 'requester' })).resolves.toMatchObject({
      success: true,
      usersAnonymized: 1,
      relatedRecordsAnonymized: 2,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^anonymized:[a-f0-9]{64}$/),
        roles: [],
        permissions: [],
        claims: Prisma.JsonNull,
      },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'requester' } });
    expect(prisma.pollImage.updateMany).toHaveBeenCalledWith({
      where: { createdById: 'requester' },
      data: { createdById: expect.stringMatching(/^anonymized:[a-f0-9]{64}$/) },
    });
  });

  it('does not collide when two subjects use the same request id', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'requester-a' });
    prisma.user.create.mockResolvedValue({ id: 'anonymized' });
    prisma.user.delete.mockResolvedValue({ id: 'requester' });
    prisma.pollImage.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await service.hardDelete({ requestId: 'same-request', userId: 'requester-a' });
    await service.hardDelete({ requestId: 'same-request', userId: 'requester-b' });

    const firstId = prisma.user.create.mock.calls[0][0].data.id;
    const secondId = prisma.user.create.mock.calls[1][0].data.id;
    expect(firstId).toMatch(/^anonymized:[a-f0-9]{64}$/);
    expect(secondId).toMatch(/^anonymized:[a-f0-9]{64}$/);
    expect(firstId).not.toBe(secondId);
  });

  it('treats a same-subject retry as an idempotent completed deletion', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'requester' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'anonymized' });
    prisma.user.create.mockResolvedValue({ id: 'anonymized' });
    prisma.user.delete.mockResolvedValue({ id: 'requester' });
    prisma.pollImage.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'retry', userId: 'requester' })).resolves.toMatchObject({ success: true });
    await expect(service.hardDelete({ requestId: 'retry', userId: 'requester' })).resolves.toMatchObject({
      success: true,
      alreadyAnonymized: true,
    });
  });

  it('reports a failed deletion when the user does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.pollImage.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'request-1', userId: 'missing' })).resolves.toMatchObject({
      success: false,
      usersAnonymized: 0,
    });
  });
});
