import { PollCacicElectionElementsService } from './poll-cacic-election-elements.service';
import { externalPollElementId, externalPollOptionId } from './poll-identifiers';

function tx() {
  return {
    poll: { findUnique: jest.fn().mockResolvedValue({ mode: 'CACIC_ELECTION', cacicElectionPhase: 'ELECTION' }) },
    cacicElectionSlate: { findMany: jest.fn().mockResolvedValue([{ id: 'slate-1', name: 'Aurora' }]) },
    pollElement: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

describe('CACiC generated poll element identifiers', () => {
  it('uses poll-scoped generated IDs for two election definitions', async () => {
    const service = new PollCacicElectionElementsService();
    const first = tx();
    const second = tx();
    await service.refreshCacicElectionVoteElement(first as never, 'poll-1');
    await service.refreshCacicElectionVoteElement(second as never, 'poll-2');

    const firstElement = first.pollElement.create.mock.calls[0][0].data;
    const secondElement = second.pollElement.create.mock.calls[0][0].data;
    expect(firstElement.id).not.toBe(secondElement.id);
    expect(externalPollElementId('poll-1', firstElement.id)).toBe('cacic-election-vote');
    expect(externalPollElementId('poll-2', secondElement.id)).toBe('cacic-election-vote');
    expect(externalPollOptionId(firstElement.id, firstElement.options.create[0].id)).toBe('slate:slate-1');
  });
});
