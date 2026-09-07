import { ConflictException } from '@nestjs/common';
import { PollStatus as DbPollStatus } from '@prisma/client';
import { PollEligibilityService } from './poll-eligibility.service';

describe('PollEligibilityService import and mutation boundaries', () => {
  it('detects a delimiter outside quoted header fields', () => {
    const service = new PollEligibilityService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(service.parseEligibilityImport({
      format: 'csv',
      selectedHeader: 'matrícula, institucional',
      content: '"matrícula, institucional";nome\n123;Ada',
    })).toMatchObject({ enrollmentNumbers: ['123'] });
  });

  it('bounds a slow external attendance check when used by a vote transaction', async () => {
    jest.useFakeTimers();
    try {
      const eventManager = { hasAttendance: jest.fn().mockReturnValue(new Promise<boolean>(() => undefined)) };
      const service = new PollEligibilityService(
        {} as never,
        eventManager as never,
        {} as never,
        {} as never,
      );
      const check = service.ensureVotingAllowed(
        {
          id: 'poll-1',
          mode: 'REGULAR',
          cacicElectionPhase: null,
          voterEligibilitySource: 'EVENT_ATTENDANCE',
          requireVerifiedUnespRole: false,
          linkedEventId: 'event-1',
        } as never,
        { sub: 'user-1' } as never,
        {} as never,
        { remoteTimeoutMs: 25 },
      );

      const assertion = expect(check).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(25);
      await assertion;
      expect(eventManager.hasAttendance).toHaveBeenCalledWith(
        'event-1',
        'user-1',
        { timeoutMs: 25, maxAttempts: 1 },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps a serializable eligibility mutation conflict to a retryable API conflict', async () => {
    const prisma = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({ id: 'poll-1', status: DbPollStatus.DRAFT }),
      },
      pollEligibilityEnrollment: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }),
    };
    const service = new PollEligibilityService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const mutation = service.deleteEligibilityEnrollment('poll-1', '20240001');
    await expect(mutation).rejects.toBeInstanceOf(ConflictException);
    await expect(mutation).rejects.toThrow('Eligibility list changed concurrently');
  });
});
