import { pollInclude } from './polls/poll-records';
import { toContractPoll } from './polls/poll-contract.mapper';
import { namespacedPollElementId, namespacedPollOptionId } from './polls/poll-identifiers';

describe('poll active-definition queries', () => {
  it('exclude retired elements from active poll reads', () => {
    expect(pollInclude.elements).toMatchObject({ where: { retiredAt: null } });
  });

  it('maps namespaced database IDs back to client IDs', () => {
    const elementId = namespacedPollElementId('poll-1', 'question-1');
    const optionId = namespacedPollOptionId(elementId, 'option-1');
    const poll = toContractPoll({
      id: 'poll-1',
      title: 'Poll',
      description: null,
      status: 'DRAFT',
      mode: 'REGULAR',
      cacicElectionPhase: null,
      votingStyle: 'SECRET',
      voterEligibilitySource: 'AUTHENTICATED_USERS',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      directLinkToken: null,
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      linkedEventId: null,
      linkedEventName: null,
      linkedEventStartDate: null,
      linkedEventEndDate: null,
      linkedEventLocationDescription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: null,
      visibleFrom: null,
      votingStartsAt: null,
      votingEndsAt: null,
      elements: [{
        id: elementId,
        type: 'SINGLE_CHOICE',
        title: 'Question',
        description: null,
        required: true,
        settings: null,
        position: 0,
        options: [{ id: optionId, label: 'Option', description: null, position: 0 }],
      }],
      images: [],
      _count: { responses: 0 },
    } as never);
    expect(poll.elements[0]).toMatchObject({ id: 'question-1', options: [{ id: 'option-1' }] });
    expect(JSON.stringify(poll)).not.toContain('_cacic_');
  });
});
