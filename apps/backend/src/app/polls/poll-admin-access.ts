import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  hasElectionsObserverRole,
  hasVotingAdminRole,
} from '@org/voting-contracts';
import { PollMode as DbPollMode, Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/auth.types';

export type AdminPollAudience = 'admin' | 'observer';

export type ObserverElectionWindowPoll = {
  mode: DbPollMode;
  createdAt?: Date | null;
  publishedAt?: Date | null;
  visibleFrom?: Date | null;
  votingStartsAt?: Date | null;
};

export function resolveAdminPollAudience(user?: AuthenticatedPrincipal): AdminPollAudience {
  if (!user) {
    throw new UnauthorizedException('Missing authenticated user.');
  }

  if (hasVotingAdminRole(user.roles) || user.permissionSet.has('poll#read')) {
    return 'admin';
  }

  if (hasElectionsObserverRole(user.roles)) {
    return 'observer';
  }

  throw new ForbiddenException('Missing permissions: poll#read.');
}

export function observerElectionPollWhere(now = new Date()): Prisma.PollWhereInput {
  const { previousMonthStart, nextMonthStart } = observerElectionWindow(now);

  return {
    mode: DbPollMode.CACIC_ELECTION,
    OR: [
      {
        votingStartsAt: {
          gte: previousMonthStart,
          lt: nextMonthStart,
        },
      },
      {
        votingStartsAt: null,
        visibleFrom: {
          gte: previousMonthStart,
          lt: nextMonthStart,
        },
      },
      {
        votingStartsAt: null,
        visibleFrom: null,
        publishedAt: {
          gte: previousMonthStart,
          lt: nextMonthStart,
        },
      },
      {
        votingStartsAt: null,
        visibleFrom: null,
        publishedAt: null,
        createdAt: {
          gte: previousMonthStart,
          lt: nextMonthStart,
        },
      },
    ],
  };
}

export function assertObserverCanReadElectionPoll(
  poll: ObserverElectionWindowPoll,
  now = new Date(),
): void {
  if (!isObserverReadableElectionPoll(poll, now)) {
    throw new NotFoundException('Poll not found.');
  }
}

export function isObserverReadableElectionPoll(
  poll: ObserverElectionWindowPoll,
  now = new Date(),
): boolean {
  if (poll.mode !== DbPollMode.CACIC_ELECTION) {
    return false;
  }

  const startDate = poll.votingStartsAt ?? poll.visibleFrom ?? poll.publishedAt ?? poll.createdAt;
  if (!startDate) {
    return false;
  }

  const { previousMonthStart, nextMonthStart } = observerElectionWindow(now);
  return startDate >= previousMonthStart && startDate < nextMonthStart;
}

function observerElectionWindow(now: Date): { previousMonthStart: Date; nextMonthStart: Date } {
  const currentMonthStart = new Date(now);
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);

  const previousMonthStart = new Date(currentMonthStart);
  previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);

  const nextMonthStart = new Date(currentMonthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

  return { previousMonthStart, nextMonthStart };
}
