import { PollImagePlacement as DbPollImagePlacement } from '@prisma/client';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';

describe('PollImageMutationsService staging boundaries', () => {
  it('preserves every staged upload when another editor saves the poll', async () => {
    const tx = {
      pollImage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'staged-by-editor-b',
            objectKey: 'polls/poll-1/images/staged.avif',
            placement: DbPollImagePlacement.UNUSED,
            createdById: 'editor-b',
          },
          {
            id: 'attached-by-editor-a',
            objectKey: 'polls/poll-1/images/attached.avif',
            placement: DbPollImagePlacement.POLL_DESCRIPTION,
            createdById: 'editor-a',
          },
        ]),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pollElement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      pollObjectDeletion: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new PollImageMutationsService(new PollMutationValidationService());

    await expect(service.reconcilePollImages(
      tx as never,
      'poll-1',
      { title: 'Poll', elements: [] } as never,
    )).resolves.toEqual(['polls/poll-1/images/attached.avif']);

    expect(tx.pollImage.deleteMany).toHaveBeenCalledWith({
      where: { pollId: 'poll-1', id: { in: ['attached-by-editor-a'] } },
    });
    expect(tx.pollObjectDeletion.createMany).toHaveBeenCalledWith({
      data: [{ objectKey: 'polls/poll-1/images/attached.avif' }],
      skipDuplicates: true,
    });
  });
});
