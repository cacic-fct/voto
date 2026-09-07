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

  it('allows admin slate review during published submission and freezes election phase', async () => {
    const tx = {
      poll: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'poll-1', mode: DbMode.CACIC_ELECTION, cacicElectionPhase: DbPhase.SLATE_SUBMISSION,
            status: DbStatus.PUBLISHED, _count: { responses: 0 },
          })
          .mockResolvedValueOnce({
            id: 'poll-1', mode: DbMode.CACIC_ELECTION, cacicElectionPhase: DbPhase.ELECTION,
            status: DbStatus.PUBLISHED, _count: { responses: 0 },
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
    await expect(internals.assertCacicElectionPollMutable(tx, 'poll-1')).resolves.toBeUndefined();
    await expect(internals.assertCacicElectionPollMutable(tx, 'poll-1')).rejects.toThrow(ConflictException);
  });

  it('maps serializable admin slate conflicts to a retryable conflict', async () => {
    const prisma = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'poll-1',
          mode: DbMode.CACIC_ELECTION,
          cacicElectionPhase: DbPhase.SLATE_SUBMISSION,
          status: DbStatus.DRAFT,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          publishedAt: null,
          visibleFrom: null,
          votingStartsAt: null,
          _count: { responses: 0 },
        }),
      },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }),
    };
    const service = new PollCacicElectionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const mutation = service.deleteCacicElectionSlate('poll-1', 'slate-1');
    await expect(mutation).rejects.toBeInstanceOf(ConflictException);
    await expect(mutation).rejects.toThrow('election changed concurrently');
  });
});
