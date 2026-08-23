import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { externalPollElementId, externalPollOptionId } from './poll-identifiers';

function transaction() {
  const tx = {
    pollElement: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    pollElementOption: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return tx;
}

const input = {
  title: 'Poll',
  elements: [{
    id: 'question-1',
    type: 'singleChoice',
    title: 'Question',
    required: true,
    options: [{ id: 'option-1', label: 'Option' }],
  }],
} as unknown as { elements: Array<{
  id: string;
  type: 'singleChoice';
  title: string;
  required: boolean;
  options: Array<{ id: string; label: string }>;
}> };

describe('PollElementMutationsService cross-poll identifiers', () => {
  it('namespaces new element and option primary keys per poll while preserving public IDs', async () => {
    const service = new PollElementMutationsService({
      normalizeElementSettings: jest.fn().mockReturnValue(undefined),
    } as unknown as PollMutationOptionsService);
    const first = transaction();
    const second = transaction();

    await service.syncElements(first as never, 'poll-1', input.elements);
    await service.syncElements(second as never, 'poll-2', input.elements);

    const firstElementId = first.pollElement.create.mock.calls[0][0].data.id;
    const secondElementId = second.pollElement.create.mock.calls[0][0].data.id;
    const firstOptionId = first.pollElement.create.mock.calls[0][0].data.options.create[0].id;
    const secondOptionId = second.pollElement.create.mock.calls[0][0].data.options.create[0].id;
    expect(firstElementId).not.toBe(secondElementId);
    expect(firstOptionId).not.toBe(secondOptionId);
    expect(externalPollElementId('poll-1', firstElementId)).toBe('question-1');
    expect(externalPollElementId('poll-2', secondElementId)).toBe('question-1');
    expect(externalPollOptionId(firstElementId, firstOptionId)).toBe('option-1');
    expect(externalPollOptionId(secondElementId, secondOptionId)).toBe('option-1');
  });

  it('keeps legacy raw IDs stable when an existing poll is edited', async () => {
    const service = new PollElementMutationsService({
      normalizeElementSettings: jest.fn().mockReturnValue(undefined),
    } as unknown as PollMutationOptionsService);
    const tx = transaction();
    tx.pollElement.findMany.mockResolvedValueOnce([{
      id: 'question-1',
      pollId: 'poll-legacy',
      type: 'SHORT_TEXT',
      title: 'Question',
      description: null,
      required: true,
      settings: null,
      position: 0,
      retiredAt: null,
      options: [{ id: 'option-1', label: 'Option', description: null, position: 0 }],
      _count: { answers: 0 },
    }]);
    tx.pollElementOption.findMany.mockResolvedValueOnce([{ id: 'option-1' }]);

    await service.syncElements(tx as never, 'poll-legacy', input.elements);
    expect(tx.pollElement.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'question-1' } }));
    expect(tx.pollElement.create).not.toHaveBeenCalled();
    expect(tx.pollElementOption.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'option-1', elementId: 'question-1' })],
    });
  });
});
