import { ConflictException } from '@nestjs/common';
import { CacicElectionPhase as DbPhase, PollMode as DbMode, PollStatus as DbStatus } from '@prisma/client';
import { PollCacicElectionService } from './poll-cacic-election.service';

describe('PollCacicElectionService state boundaries', () => {
  it('allows reading an existing slate after the submission window closes', async () => {
    const prisma = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({
          mode: DbMode.CACIC_ELECTION,
          cacicElectionPhase: DbPhase.SLATE_SUBMISSION,
          status: DbStatus.CLOSED,
          visibleFrom: null,
        }),
      },
    };
    const service = new PollCacicElectionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const internals = service as unknown as {
      assertCacicElectionSlateReadable(pollId: string): Promise<void>;
    };
    await expect(internals.assertCacicElectionSlateReadable('poll-1')).resolves.toBeUndefined();
  });

  it('rejects mutable slate checks once a poll is published', async () => {
    const tx = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'poll-1', mode: DbMode.CACIC_ELECTION, status: DbStatus.PUBLISHED,
          _count: { responses: 0 },
        }),
      },
    };
    const service = new PollCacicElectionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const internals = service as unknown as {
      assertCacicElectionPollMutable(client: unknown, pollId: string): Promise<void>;
    };
    await expect(internals.assertCacicElectionPollMutable(tx, 'poll-1')).rejects.toThrow(ConflictException);
  });
});
