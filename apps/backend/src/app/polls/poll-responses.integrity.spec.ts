import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PollStatus as DbPollStatus, PollVotingStyle as DbPollVotingStyle, PollMode as DbPollMode, PollVoterEligibilitySource as DbEligibility, PollElementType as DbElementType } from '@prisma/client';
import { PollResponsesService } from './poll-responses.service';

function poll() {
  const now = new Date('2026-06-24T10:00:00.000Z');
  return {
    id: 'poll-1', title: 'Poll', description: null, status: DbPollStatus.PUBLISHED,
    mode: DbPollMode.REGULAR, cacicElectionPhase: null, votingStyle: DbPollVotingStyle.SECRET,
    voterEligibilitySource: DbEligibility.AUTHENTICATED_USERS, requireVerifiedUnespRole: false,
    directLinkEnabled: false, directLinkToken: null, resultsPublic: false, resultsLive: false,
    allowResponseEditing: false, allowMultipleResponses: false, linkedEventId: null,
    linkedEventName: null, linkedEventStartDate: null, linkedEventEndDate: null,
    linkedEventLocationDescription: null, createdAt: now, updatedAt: now, publishedAt: now,
    visibleFrom: null, votingStartsAt: null, votingEndsAt: null,
    elements: [{ id: 'question-1', type: DbElementType.SHORT_TEXT, title: 'Question', description: null,
      required: false, settings: null, position: 0, retiredAt: null, options: [] }],
    images: [], _count: { responses: 0 },
  };
}

describe('PollResponsesService transaction rechecks', () => {
  it('publishes distinct edit mutations even when the database timestamp is identical', async () => {
    const current = { ...poll(), allowResponseEditing: true };
    const response = { id: 'response-1', pollId: current.id, submittedAt: current.updatedAt, answers: [] };
    const prisma = {
      poll: { findFirst: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn().mockResolvedValue(response),
    };
    const results = { publishPollResultsForResponse: jest.fn().mockResolvedValue(undefined) };
    const service = new PollResponsesService(prisma as never, {} as never, results as never);
    await service.submitResponse(current.id, { answers: [{ elementId: 'question-1', value: 'first' }] }, { sub: 'user-1' } as never);
    await service.submitResponse(current.id, { answers: [{ elementId: 'question-1', value: 'second' }] }, { sub: 'user-1' } as never);
    const keys = results.publishPollResultsForResponse.mock.calls.map((call) => call[2]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => typeof key === 'string' && key.length > 0)).toBe(true);
  });

  it('rejects when the poll closes after pre-validation', async () => {
    const current = poll();
    const prisma = {} as {
      poll: { findFirst: jest.Mock };
      $transaction: jest.Mock;
      $executeRaw: jest.Mock;
      revokedVotingSubject: { findUnique: jest.Mock };
    };
    prisma.poll = { findFirst: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(null) };
    prisma.$executeRaw = jest.fn().mockResolvedValue(0);
    prisma.revokedVotingSubject = { findUnique: jest.fn().mockResolvedValue(null) };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    const service = new PollResponsesService(
      prisma as never,
      { ensureVotingAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { publishPollResultsForResponse: jest.fn() } as never,
    );

    await expect(service.submitResponse('poll-1', {
      answers: [{ elementId: 'question-1', value: 'answer' }],
    }, { sub: 'user-1' } as never)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: expect.anything(),
    }));
  });

  it('rejects a voter whose subject was revoked before the transaction writes markers', async () => {
    const current = poll();
    const prisma = {} as {
      poll: { findFirst: jest.Mock };
      $transaction: jest.Mock;
      $executeRaw: jest.Mock;
      revokedVotingSubject: { findUnique: jest.Mock };
    };
    prisma.poll = { findFirst: jest.fn().mockResolvedValue(current) };
    prisma.$executeRaw = jest.fn().mockResolvedValue(0);
    prisma.revokedVotingSubject = { findUnique: jest.fn().mockResolvedValue({ subjectHash: 'revoked' }) };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    const service = new PollResponsesService(
      prisma as never,
      { ensureVotingAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { publishPollResultsForResponse: jest.fn() } as never,
    );

    await expect(service.submitResponse('poll-1', {
      answers: [{ elementId: 'question-1', value: 'answer' }],
    }, { sub: 'user-1' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});
