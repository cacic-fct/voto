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
    expect(prisma.poll.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'poll-1', updatedAt: new Date(updatedAt.getTime() - 1) }),
    }));
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
});
