import { PollElement, PollResponse, PollResponseAnswer } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import { toContractElement, toElementSnapshotJson } from './poll-contract.mapper';
import { ElementRecord, PollResultResponseRecord } from './poll-records';
import { isRecord } from './poll-user-claims';

export const pollResponseInclude = {
  answers: {
    include: {
      element: {
        include: {
          options: {
            orderBy: { position: 'asc' },
          },
        },
      },
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
    answers: response.answers.map((answer) => toContractPollResponseAnswer(answer)),
  };
}

export function toContractPollResponseAnswer(answer: PollResultResponseRecord['answers'][number]): PollResponseAnswer {
  const element = readAnswerElementSnapshot(answer) ?? toContractElement(answer.element, [], {});

  return {
    elementId: answer.elementId,
    value: answer.value as PollResponseAnswer['value'],
    element,
  };
}

export function readAnswerElementSnapshot(answer: PollResultResponseRecord['answers'][number]): PollElement | null {
  return isRecord(answer.elementSnapshot) ? (answer.elementSnapshot as PollElement) : null;
}

export function buildAnswerElementSnapshots(elements: ElementRecord[]): Map<string, Prisma.InputJsonValue> {
  return new Map(elements.map((element) => [element.id, toElementSnapshotJson(element)]));
}

export function toAnswerCreateData(
  answer: PollResponseAnswer,
  answerElementSnapshots: Map<string, Prisma.InputJsonValue>,
): Prisma.PollAnswerUncheckedCreateWithoutResponseInput {
  return {
    elementId: answer.elementId,
    value: answer.value as Prisma.InputJsonValue,
    elementSnapshot: answerElementSnapshots.get(answer.elementId) ?? Prisma.JsonNull,
  };
}
