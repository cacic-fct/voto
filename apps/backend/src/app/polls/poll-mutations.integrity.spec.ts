import { ConflictException } from '@nestjs/common';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import { PollMutationsService } from './poll-mutations.service';

function createService() {
  const updatedAt = new Date('2026-06-24T10:00:00.000Z');
  const prisma = {} as {
    poll: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  prisma.poll = {
    findUnique: jest.fn().mockResolvedValue({
        id: 'poll-1',
        status: 'DRAFT',
        mode: 'REGULAR',
        cacicElectionPhase: null,
        votingStyle: 'SECRET',
        voterEligibilitySource: 'AUTHENTICATED_USERS',
        requireVerifiedUnespRole: false,
        directLinkEnabled: false,
        directLinkToken: null,
        resultsPublic: false,
        resultsLive: false,
        allowResponseEditing: false,
        allowMultipleResponses: false,
        linkedEventId: null,
        linkedEventName: null,
        linkedEventStartDate: null,
        linkedEventEndDate: null,
        linkedEventLocationDescription: null,
        publishedAt: null,
        closedAt: null,
        updatedAt,
    }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
  const eventManager = { listLinkableEvents: jest.fn() };
  const validation = new PollMutationValidationService();
  const options = new PollMutationOptionsService(eventManager as never);
  const service = new PollMutationsService(
    prisma as never,
    eventManager as never,
    {} as never,
    { deleteObjectKeysBestEffort: jest.fn() } as never,
    validation,
    options,
    new PollElementMutationsService(options),
    new PollImageMutationsService(validation),
  );
  return { service, prisma, updatedAt };
}

describe('PollMutationsService concurrency and lifecycle boundaries', () => {
  it('rejects status fields on ordinary saves before persistence', async () => {
    const { service } = createService();
    await expect(service.updatePoll('poll-1', {
      title: 'Poll',
      elements: [],
      status: 'published',
      expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
    } as never, { sub: 'admin-1' } as never)).rejects.toThrow(ConflictException);
  });

  it('rejects stale full-definition updates with a conflict and never syncs elements', async () => {
    const { service, prisma, updatedAt } = createService();
    await expect(service.updatePoll('poll-1', {
      title: 'Poll',
      elements: [],
      expectedUpdatedAt: new Date(updatedAt.getTime() - 1).toISOString(),
    }, { sub: 'admin-1' } as never)).rejects.toThrow(ConflictException);
    expect(prisma.poll.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid lifecycle transitions', async () => {
    const { service } = createService();
    await expect(service.updatePollStatus(
      'poll-1',
      'closed',
      { sub: 'admin-1' } as never,
      '2026-06-24T10:00:00.000Z',
    )).rejects.toThrow('cannot transition');
  });

  it('rejects a privacy downgrade after a ballot was collected', async () => {
    const { service, prisma } = createService();
    const updatedAt = new Date('2026-06-24T10:00:00.000Z');
    prisma.poll.findUnique.mockResolvedValue({
      status: 'CLOSED',
      mode: 'REGULAR',
      cacicElectionPhase: null,
      votingStyle: 'SECRET',
      voterEligibilitySource: 'AUTHENTICATED_USERS',
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      directLinkEnabled: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      updatedAt,
      _count: { responses: 1 },
    });

    await expect(service.updatePoll('poll-1', {
      title: 'Poll',
      elements: [],
      expectedUpdatedAt: updatedAt.toISOString(),
      votingStyle: 'public',
    }, { sub: 'admin-1' } as never)).rejects.toThrow('voting privacy policy');
    expect(prisma.poll.updateMany).not.toHaveBeenCalled();
  });

  it('requires an approved slate and enrollment before entering the election phase', async () => {
    const { service } = createService();
    const internals = service as never as {
      assertElectionTransitionReady(
        tx: unknown,
        pollId: string,
        existing: { mode: string; cacicElectionPhase: string },
        metadata: { mode: string; cacicElectionPhase: string },
      ): Promise<void>;
    };
    const tx = {
      cacicElectionSlate: { findFirst: jest.fn().mockResolvedValue(null) },
      pollEligibilityEnrollment: { findFirst: jest.fn() },
    };

    await expect(internals.assertElectionTransitionReady(
      tx,
      'poll-1',
      { mode: 'CACIC_ELECTION', cacicElectionPhase: 'SLATE_SUBMISSION' },
      { mode: 'CACIC_ELECTION', cacicElectionPhase: 'ELECTION' },
    )).rejects.toThrow('approved and enabled slate');
    expect(tx.pollEligibilityEnrollment.findFirst).not.toHaveBeenCalled();
  });

  it('does not reopen a closed submission poll by changing its election phase', async () => {
    const { service, prisma } = createService();
    const updatedAt = new Date('2026-06-24T10:00:00.000Z');
    prisma.poll.findUnique.mockResolvedValue({
      status: 'CLOSED',
      mode: 'CACIC_ELECTION',
      cacicElectionPhase: 'SLATE_SUBMISSION',
      votingStyle: 'SECRET',
      voterEligibilitySource: 'AUTHENTICATED_USERS',
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      directLinkEnabled: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      updatedAt,
      _count: { responses: 0 },
    });

    await expect(service.updatePoll('poll-1', {
      title: 'Poll',
      elements: [],
      expectedUpdatedAt: updatedAt.toISOString(),
      mode: 'cacicElection',
      cacicElectionPhase: 'election',
    }, { sub: 'admin-1' } as never)).rejects.toThrow('election phase');
  });
});
