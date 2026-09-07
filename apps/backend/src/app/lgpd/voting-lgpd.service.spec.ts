import { PrismaService } from '../prisma/prisma.service';
import { VotingLgpdService } from './voting-lgpd.service';
import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

type PrismaMock = {
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
  votingDeletionRequest: { findUnique: jest.Mock; upsert: jest.Mock };
  revokedVotingSubject: { findUnique: jest.Mock; upsert: jest.Mock };
  user: { findUnique: jest.Mock; updateMany: jest.Mock; create: jest.Mock; delete: jest.Mock };
  pollAdminAudit: { findMany: jest.Mock; updateMany: jest.Mock };
  pollImage: { updateMany: jest.Mock };
  pollResponse: { findMany: jest.Mock; updateMany: jest.Mock };
  pollVoter: { findMany: jest.Mock; updateMany: jest.Mock };
  poll: { findMany: jest.Mock; updateMany: jest.Mock };
  pollEligibilityEnrollment: { findMany: jest.Mock; updateMany: jest.Mock };
  cacicElectionSlate: { findMany: jest.Mock; updateMany: jest.Mock };
  cacicElectionSlateMember: { findMany: jest.Mock; updateMany: jest.Mock };
};

function createPrismaMock(): PrismaMock {
  return {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    votingDeletionRequest: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)) },
    revokedVotingSubject: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    user: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    pollAdminAudit: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pollImage: { updateMany: jest.fn() },
    pollResponse: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pollVoter: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    poll: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pollEligibilityEnrollment: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cacicElectionSlate: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cacicElectionSlateMember: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

describe('VotingLgpdService', () => {
  it('persists schedule and cancellation, and rejects delayed deletion after cancellation', async () => {
    const prisma = createPrismaMock();
    const requests = new Map<string, { state: string }>();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.votingDeletionRequest.findUnique.mockImplementation(({ where }) => Promise.resolve(requests.get(where.requestHash) ?? null));
    prisma.votingDeletionRequest.upsert.mockImplementation(({ where, create, update }) => {
      const record = requests.has(where.requestHash) ? { ...requests.get(where.requestHash), ...update } : create;
      requests.set(where.requestHash, record);
      return Promise.resolve(record);
    });
    const input = { requestId: 'request-1', userId: 'requester' };
    const service = new VotingLgpdService(prisma as unknown as PrismaService);
    await expect(service.scheduleDeletion(input)).resolves.toMatchObject({ success: true, state: 'pending', executionOwner: 'account_manager' });
    // A new service instance uses the persisted ledger, with no timer to restore.
    const restarted = new VotingLgpdService(prisma as unknown as PrismaService);
    await expect(restarted.cancelDeletion(input)).resolves.toMatchObject({ success: true, state: 'cancelled' });
    await expect(restarted.cancelDeletion(input)).resolves.toMatchObject({ success: true, state: 'cancelled' });
    await expect(restarted.scheduleDeletion(input)).rejects.toBeInstanceOf(ConflictException);
    await expect(restarted.hardDelete(input)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.revokedVotingSubject.upsert).not.toHaveBeenCalled();
  });

  it('keeps a subject revocation stable across different request IDs without plaintext identifiers', async () => {
    const prisma = createPrismaMock();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.revokedVotingSubject.findUnique.mockResolvedValue({ subjectHash: 'previous' });
    const service = new VotingLgpdService(prisma as unknown as PrismaService);
    await service.hardDelete({ requestId: 'first', userId: 'subject' });
    await expect(service.hardDelete({ requestId: 'second', userId: 'subject' })).resolves.toMatchObject({ success: true, alreadyAnonymized: true });
    const first = prisma.revokedVotingSubject.upsert.mock.calls[0][0];
    expect(first).toEqual(prisma.revokedVotingSubject.upsert.mock.calls[1][0]);
    expect(first.create.subjectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('"subject"');
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
      metadata: { source: 'cacic_voto', userId: 'requester', identityInventoryComplete: false },
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
      where: { verifiedSubjectHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
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
      identityInventoryComplete: false,
      retainedUnlinkedData: ['legacy_unlinked_slate_member_identity_fields', 'eligibility_enrollment_numbers'],
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

  it('redacts verified slate memberships even when the subject has no local profile', async () => {
    const prisma = createPrismaMock();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.cacicElectionSlateMember.updateMany.mockResolvedValue({ count: 2 });
    const service = new VotingLgpdService(prisma as unknown as PrismaService);
    await expect(service.hardDelete({ requestId: 'redact', userId: 'member-only' })).resolves.toMatchObject({
      success: true, usersAnonymized: 0, relatedRecordsAnonymized: 2,
    });
    expect(prisma.cacicElectionSlateMember.updateMany).toHaveBeenCalledWith({
      where: { verifiedSubjectHash: expect.stringMatching(/^[a-f0-9]{64}$/), NOT: { identifierValue: { startsWith: 'anonymized:' } } },
      data: { fullName: 'Anonimizado', enrollmentNumber: null, identifierValue: expect.stringMatching(/^anonymized:[a-f0-9]{64}$/) },
    });
    expect(prisma.pollVoter.updateMany).not.toHaveBeenCalled();
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

  it('completes deletion idempotently when the user does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.pollImage.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new VotingLgpdService(prisma as unknown as PrismaService);

    await expect(service.hardDelete({ requestId: 'request-1', userId: 'missing' })).resolves.toMatchObject({
      success: true,
      usersAnonymized: 0,
    });
  });
});
