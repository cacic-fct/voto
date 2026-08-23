import { PollElement, PollResponse, PollResponseAnswer } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import { PollResultResponseRecord } from './poll-records';
import { externalPollElementId, externalPollOptionId } from './poll-identifiers';

export const pollResponseInclude = {
  answers: {
      select: {
        elementId: true,
        value: true,
        elementSnapshot: true,
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      preferredUsername: true,
      email: true,
      claims: true,
    },
  },
} satisfies Prisma.PollResponseInclude;

export function toContractPollResponse(response: PollResultResponseRecord): PollResponse {
  return {
    id: response.id,
    pollId: response.pollId,
    submittedAt: response.submittedAt?.toISOString(),
    answers: response.answers.map((answer) => toContractPollResponseAnswer(answer, response.pollId)),
  };
}

export function toContractPollResponseAnswer(
  answer: PollResultResponseRecord['answers'][number],
  pollId = '',
): PollResponseAnswer {
  const elementId = externalPollElementId(pollId, answer.elementId);
  const element = toContractSnapshotElement(answer.elementSnapshot, pollId, answer.elementId);
  return {
    elementId,
    value: normalizeStoredAnswerValue(
      answer.elementId,
      answer.value,
      element?.type,
    ) as PollResponseAnswer['value'],
    ...(element ? { element } : {}),
  };
}

function normalizeStoredAnswerValue(elementId: string, value: unknown, elementType?: PollElement['type']): unknown {
  if (typeof value === 'string') {
    return elementType === 'singleChoice' || elementType === 'selectionDropdown' || elementType === 'multipleChoice'
      ? externalPollOptionId(elementId, value)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStoredAnswerValue(elementId, item, elementType));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeStoredAnswerValue(elementId, item, elementType),
      ]),
    );
  }

  return value;
}

function toContractSnapshotElement(value: unknown, pollId: string, storedElementId: string): PollElement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot['id'] !== 'string' ||
    typeof snapshot['type'] !== 'string' ||
    typeof snapshot['title'] !== 'string' ||
    typeof snapshot['required'] !== 'boolean' ||
    !Array.isArray(snapshot['options'])
  ) return undefined;

  const options = snapshot['options'].map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
    const normalized = option as Record<string, unknown>;
    return {
      ...normalized,
      id: typeof normalized['id'] === 'string'
        ? externalPollOptionId(storedElementId, normalized['id'])
        : normalized['id'],
    };
  });
  return {
    ...snapshot,
    id: externalPollElementId(pollId, snapshot['id']),
    options,
  } as unknown as PollElement;
}
