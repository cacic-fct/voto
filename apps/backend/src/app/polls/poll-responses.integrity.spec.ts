import { ConflictException } from '@nestjs/common';
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
  it('rejects when the poll closes after pre-validation', async () => {
    const current = poll();
    const prisma = {} as { poll: { findFirst: jest.Mock }; $transaction: jest.Mock };
    prisma.poll = { findFirst: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(null) };
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
});
