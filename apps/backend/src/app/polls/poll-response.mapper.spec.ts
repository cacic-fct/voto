import { namespacedPollElementId, namespacedPollOptionId } from './poll-identifiers';
import { toContractPollResponse } from './poll-response.mapper';

describe('poll response historical mapping', () => {
  it('returns external question/option IDs and an immutable public element snapshot', () => {
    const storedElementId = namespacedPollElementId('poll-1', 'question-1');
    const storedOptionId = namespacedPollOptionId(storedElementId, 'option-1');
    const response = toContractPollResponse({
      id: 'response-1',
      pollId: 'poll-1',
      submittedAt: new Date('2026-06-21T12:00:00.000Z'),
      createdAt: new Date('2026-06-21T12:00:00.000Z'),
      userId: 'user-1',
      answers: [{
        elementId: storedElementId,
        value: storedOptionId,
        elementSnapshot: {
          id: 'question-1',
          type: 'singleChoice',
          title: 'Original question',
          required: true,
          options: [{ id: 'option-1', label: 'Original option' }],
        },
      }],
      user: null,
    } as never);

    expect(response.answers[0]).toMatchObject({
      elementId: 'question-1',
      value: 'option-1',
      element: {
        id: 'question-1',
        title: 'Original question',
        options: [{ id: 'option-1', label: 'Original option' }],
      },
    });
    expect(JSON.stringify(response)).not.toContain('_cacic_');
  });
});
