import { PollResponse, PollResponseAnswer } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import { PollResultResponseRecord } from './poll-records';

export const pollResponseInclude = {
  answers: {
    select: {
      elementId: true,
      value: true,
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
  return {
    elementId: answer.elementId,
    value: answer.value as PollResponseAnswer['value'],
  };
}
