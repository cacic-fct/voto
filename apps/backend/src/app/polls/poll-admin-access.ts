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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const next = new Date(Date.UTC(year, month, 1));
  const previousMonthStart = zonedDateTimeToInstant(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 1);
  const nextMonthStart = zonedDateTimeToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);

  return { previousMonthStart, nextMonthStart };
}

function zonedDateTimeToInstant(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(target - offsetMinutes * 60_000);
    const values = Object.fromEntries(
      formatter.formatToParts(candidate)
        .filter(({ type }) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(type))
        .map(({ type, value }) => [type, Number(value)]),
    ) as Record<string, number>;
    if (values.year === year && values.month === month && values.day === day && values.hour === 0 && values.minute === 0) {
      return candidate;
    }
  }
  return new Date(target);
}
