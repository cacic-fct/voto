import { PollMode as DbPollMode } from '@prisma/client';
import { PollMutationOptionsService } from './poll-mutation-options.service';

describe('PollMutationOptionsService integrity rules', () => {
  it('revokes a direct-link token whenever direct-link access is disabled', () => {
    const service = new PollMutationOptionsService({ listLinkableEvents: jest.fn() } as never);
    expect(service.resolvePollDirectLink(
      { directLinkEnabled: false } as never,
      { directLinkEnabled: true, directLinkToken: 'old-token' },
      { mode: DbPollMode.REGULAR },
    )).toEqual({ directLinkEnabled: false, directLinkToken: null });

    expect(service.resolvePollDirectLink(
      {} as never,
      { directLinkEnabled: true, directLinkToken: 'old-token' },
      { mode: DbPollMode.CACIC_ELECTION },
    )).toEqual({ directLinkEnabled: false, directLinkToken: null });
  });

  it('refreshes linked event metadata when a current event changes', async () => {
    const eventManager = {
      listLinkableEvents: jest.fn().mockResolvedValue([{
        id: 'event-1',
        name: 'Renamed event',
        startDate: '2026-06-24T10:00:00.000Z',
        endDate: '2026-06-24T12:00:00.000Z',
        locationDescription: 'Room 2',
      }]),
    };
    const service = new PollMutationOptionsService(eventManager as never);
    const metadata = await service.resolvePollMetadata(
      { linkedEventId: 'event-1' } as never,
      {
        linkedEventId: 'event-1',
        linkedEventName: 'Old event',
        linkedEventStartDate: new Date('2026-06-23T10:00:00.000Z'),
        linkedEventEndDate: new Date('2026-06-23T12:00:00.000Z'),
        linkedEventLocationDescription: 'Room 1',
      } as never,
    );
    expect(metadata.linkedEventName).toBe('Renamed event');
    expect(metadata.linkedEventLocationDescription).toBe('Room 2');
  });
});
