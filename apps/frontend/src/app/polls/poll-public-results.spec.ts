import { Poll, PollElement, PollResultsResponse } from '@org/voting-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildPublicQuestionSummaries,
  resultBucketPercent,
  shouldShowPublicResults,
} from './poll-public-results';

const choiceElement: PollElement = {
  id: 'choice',
  type: 'multipleChoice',
  title: 'Escolhas',
  required: true,
  options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
};

const textElement: PollElement = {
  id: 'text',
  type: 'shortText',
  title: 'Texto',
  required: false,
  options: [],
};

function createPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'poll-1',
    title: 'Consulta',
    status: 'published',
    mode: 'regular',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: true,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    elements: [choiceElement],
    ...overrides,
  };
}

describe('poll public result helpers', () => {
  it('summarizes option and text answers while ignoring empty values', () => {
    const responses: PollResultsResponse[] = [
      {
        id: 'response-1',
        answers: [
          { elementId: 'choice', value: ['a', 'b'] },
          { elementId: 'text', value: 'Comentário' },
        ],
      },
      {
        id: 'response-2',
        answers: [
          { elementId: 'choice', value: ['a'] },
          { elementId: 'text', value: '' },
        ],
      },
    ];

    expect(buildPublicQuestionSummaries([choiceElement, textElement], responses)).toEqual([
      {
        key: expect.any(String),
        element: choiceElement,
        answeredCount: 2,
        buckets: [{ label: 'A', count: 2 }, { label: 'B', count: 1 }],
        textAnswers: [],
      },
      {
        key: expect.any(String),
        element: textElement,
        answeredCount: 1,
        buckets: [],
        textAnswers: ['Comentário'],
      },
    ]);
    expect(resultBucketPercent({ answeredCount: 2 }, { count: 1 })).toBe(50);
    expect(resultBucketPercent({ answeredCount: 0 }, { count: 1 })).toBe(0);
  });

  it('gates public result visibility by election phase, live flag, and poll status', () => {
    expect(shouldShowPublicResults(createPoll({ resultsPublic: false, resultsLive: true }))).toBe(false);
    expect(shouldShowPublicResults(createPoll({ status: 'published', resultsLive: false }))).toBe(false);
    expect(shouldShowPublicResults(createPoll({ status: 'published', resultsLive: true }))).toBe(true);
    expect(shouldShowPublicResults(createPoll({ status: 'closed', resultsLive: false }))).toBe(true);
    expect(
      shouldShowPublicResults(
        createPoll({
          mode: 'cacicElection',
          cacicElectionPhase: 'election',
          resultsPublic: false,
          status: 'closed',
          resultsLive: true,
        }),
      ),
    ).toBe(false);
    expect(
      shouldShowPublicResults(
        createPoll({
          mode: 'cacicElection',
          cacicElectionPhase: 'election',
          status: 'published',
          resultsLive: true,
        }),
      ),
    ).toBe(false);
    expect(
      shouldShowPublicResults(
        createPoll({
          mode: 'cacicElection',
          cacicElectionPhase: 'election',
          status: 'closed',
          resultsLive: false,
        }),
      ),
    ).toBe(true);
  });
});
