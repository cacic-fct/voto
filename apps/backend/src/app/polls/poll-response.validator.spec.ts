import { BadRequestException } from '@nestjs/common';
import { PollElementType as DbPollElementType } from '@prisma/client';
import { namespacedPollElementId, namespacedPollOptionId } from './poll-identifiers';
import { PollRecord } from './poll-records';
import { validatePollResponse } from './poll-response.validator';

function pollWithElement(type: DbPollElementType, element: Record<string, unknown>): PollRecord {
  return {
    id: 'poll-1',
    title: 'Poll',
    description: null,
    status: 'PUBLISHED' as never,
    mode: 'REGULAR' as never,
    cacicElectionPhase: null,
    votingStyle: 'SECRET' as never,
    voterEligibilitySource: 'AUTHENTICATED_USERS' as never,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
    visibleFrom: null,
    votingStartsAt: null,
    votingEndsAt: null,
    elements: [{
      id: namespacedPollElementId('poll-1', 'question-1'),
      type,
      title: 'Question',
      description: null,
      required: false,
      settings: null,
      position: 0,
      options: [],
      ...element,
    }],
  };
}

describe('validatePollResponse', () => {
  it('accepts public IDs and stores namespaced option IDs', () => {
    const elementId = namespacedPollElementId('poll-1', 'question-1');
    const optionId = namespacedPollOptionId(elementId, 'option-1');
    const poll = pollWithElement(DbPollElementType.SINGLE_CHOICE, {
      options: [{ id: optionId, label: 'Option', description: null, position: 0 }],
    });

    expect(validatePollResponse(poll, {
      answers: [{ elementId: ' question-1 ', value: 'option-1' }],
    })).toEqual([{ elementId, value: optionId }]);
  });

  it('rejects duplicate normalized element answers and malformed optional values', () => {
    const poll = pollWithElement(DbPollElementType.SHORT_TEXT, {});
    expect(() => validatePollResponse(poll, {
      answers: [
        { elementId: 'question-1', value: 'one' },
        { elementId: ' question-1 ', value: 'two' },
      ],
    })).toThrow(BadRequestException);

    expect(() => validatePollResponse(poll, {
      answers: [{ elementId: 'question-1', value: { unexpected: true } as never }],
    })).toThrow(BadRequestException);
  });
});
