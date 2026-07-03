import { PollResults, PollResultsDelta } from '@org/voting-contracts';

export function applyResultsDelta(
  current: PollResults | null,
  delta: PollResultsDelta,
): PollResults | null {
  if (!current || current.pollId !== delta.pollId) {
    return current;
  }

  const existingResponses = new Map(
    current.responses.map((response) => [response.id, response]),
  );
  for (const response of delta.responses) {
    existingResponses.set(response.id, response);
  }

  return {
    ...current,
    responseCount: delta.responseCount,
    responses: [...existingResponses.values()],
  };
}
