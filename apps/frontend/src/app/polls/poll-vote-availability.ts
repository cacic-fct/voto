import { Poll, PollUserResponseState } from '@org/voting-contracts';
import { isSlateSubmissionPoll } from './poll-vote-cacic-election';

export const emptyResponseState: PollUserResponseState = {
  hasSubmitted: false,
  canEdit: false,
  canSubmitAnother: false,
};

export function readInstantTime(
  value: string | null | undefined,
  fallback = Number.NEGATIVE_INFINITY,
): number {
  if (!value) {
    return fallback;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? fallback : time;
}

export function isPollVotingOpen(poll: Poll, now = new Date()): boolean {
  return (
    poll.status === 'published' &&
    readInstantTime(poll.visibleFrom) <= now.getTime() &&
    readInstantTime(poll.votingStartsAt) <= now.getTime() &&
    readInstantTime(poll.votingEndsAt, Number.POSITIVE_INFINITY) >
      now.getTime()
  );
}

export function canVoteInPoll(
  poll: Poll | null,
  state: PollUserResponseState,
  loadingResponseState: boolean,
  responseStateError: string | null = null,
  now = new Date(),
): boolean {
  if (!poll) {
    return false;
  }

  return (
    isPollVotingOpen(poll, now) &&
    !isSlateSubmissionPoll(poll) &&
    !loadingResponseState &&
    !responseStateError &&
    (!state.hasSubmitted || state.canEdit || state.canSubmitAnother)
  );
}

export function canSubmitSlateInPoll(poll: Poll | null, now = new Date()): boolean {
  return Boolean(poll && isSlateSubmissionPoll(poll) && isPollVotingOpen(poll, now));
}

export function votingUnavailableTitle(poll: Poll | null, now = new Date()): string {
  if (!poll || poll.status !== 'published') {
    return 'Votação encerrada';
  }

  if (readInstantTime(poll.votingStartsAt) > now.getTime()) {
    return 'Votação ainda não aberta';
  }

  return 'Votação encerrada';
}
