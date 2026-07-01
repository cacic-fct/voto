import { BadRequestException } from '@nestjs/common';
import {
  CacicElectionPhase as DbCacicElectionPhase,
  PollMode as DbPollMode,
  PollStatus as DbPollStatus,
  Prisma,
} from '@prisma/client';
import { PollEligibilityRecord, PollRecord, PollResultsMetadata } from './poll-records';

export function publicReadablePollWhere(now: Date): Prisma.PollWhereInput {
  return {
    OR: [
      {
        status: DbPollStatus.PUBLISHED,
        OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
      },
      {
        status: DbPollStatus.CLOSED,
        resultsPublic: true,
        OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
      },
    ],
  };
}

export function pollVotingOpenWhere(now: Date): Prisma.PollWhereInput {
  return {
    OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
    AND: [
      {
        OR: [{ votingStartsAt: null }, { votingStartsAt: { lte: now } }],
      },
      {
        OR: [{ votingEndsAt: null }, { votingEndsAt: { gt: now } }],
      },
    ],
  };
}

export function isPollPubliclyVisible(
  poll: Pick<PollRecord, 'status' | 'resultsPublic' | 'visibleFrom'>,
  now: Date,
): boolean {
  const hasVisibleStarted = !poll.visibleFrom || poll.visibleFrom <= now;
  if (!hasVisibleStarted) {
    return false;
  }

  return poll.status === DbPollStatus.PUBLISHED || (poll.status === DbPollStatus.CLOSED && poll.resultsPublic);
}

export function isPollVotingOpen(
  poll: Pick<PollRecord, 'status' | 'visibleFrom' | 'votingStartsAt' | 'votingEndsAt'>,
  now: Date,
): boolean {
  return (
    poll.status === DbPollStatus.PUBLISHED &&
    (!poll.visibleFrom || poll.visibleFrom <= now) &&
    (!poll.votingStartsAt || poll.votingStartsAt <= now) &&
    (!poll.votingEndsAt || poll.votingEndsAt > now)
  );
}

export function isCacicElectionVotingPoll(
  poll: Pick<PollResultsMetadata, 'mode' | 'cacicElectionPhase'>,
): boolean {
  return poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase === DbCacicElectionPhase.ELECTION;
}

export function shouldRequireVotingEligibilityForRead(
  poll: Pick<PollEligibilityRecord, 'mode' | 'cacicElectionPhase'>,
): boolean {
  return !(poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase === DbCacicElectionPhase.SLATE_SUBMISSION);
}

export function assertPollAcceptsVoteResponses(poll: Pick<PollRecord, 'mode' | 'cacicElectionPhase'>): void {
  if (poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase !== DbCacicElectionPhase.ELECTION) {
    throw new BadRequestException('Slate submissions must use the CACiC election slate endpoint.');
  }
}
