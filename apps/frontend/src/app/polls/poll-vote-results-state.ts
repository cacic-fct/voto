import { PollResults, PollResultsDelta } from '@org/voting-contracts';

export function applyResultsDelta(
  current: PollResults | null,
  delta: PollResultsDelta,
): PollResults | null {
  if (!current || current.pollId !== delta.pollId) {
    return current;
  }

  return {
    ...current,
    answersReleased: delta.answersReleased ?? current.answersReleased,
    responseCount: delta.responseCount,
    voterCount: delta.voterCount ?? current.voterCount,
    voters: delta.voters ?? current.voters,
    aggregates: delta.aggregates ?? current.aggregates,
    responses: delta.refreshRequired ? current.responses : delta.responses,
  };
}
