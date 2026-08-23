import { BadRequestException } from '@nestjs/common';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';

type SchedulingTestElement = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  options: never[];
  settings: { scheduling: Record<string, unknown> };
};

function schedulingElement(overrides: Record<string, unknown> = {}): SchedulingTestElement {
  return {
    id: 'schedule-1',
    type: 'scheduling',
    title: 'Meeting',
    required: false,
    options: [],
    settings: {
      scheduling: {
        timezone: 'UTC',
        durationMinutes: 30,
        slotIntervalMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        inviteeMode: 'none',
        maxInvitees: 0,
        availability: [{ id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '12:00' }],
      },
    },
    ...overrides,
  } as unknown as SchedulingTestElement;
}

describe('poll mutation integrity validation', () => {
  it('normalizes IDs before duplicate checks and rejects blank IDs', () => {
    const service = new PollMutationValidationService();
    const input = {
      title: 'Poll',
      elements: [
        { id: ' question-1 ', type: 'shortText', title: 'One', required: false, options: [] },
        { id: 'question-1', type: 'shortText', title: 'Two', required: false, options: [] },
      ],
    } as never;
    expect(() => service.validatePollInput(input)).toThrow('Duplicated element id');

    expect(() => service.validatePollInput({
      title: 'Poll',
      elements: [{ id: '   ', type: 'shortText', title: 'One', required: false, options: [] }],
    } as never)).toThrow(BadRequestException);
  });

  it('rejects invalid time zones and overlapping scheduling windows', () => {
    const service = new PollMutationValidationService();
    expect(() => service.validatePollInput({
      title: 'Poll',
      elements: [schedulingElement({ settings: { scheduling: {
        ...schedulingElement().settings.scheduling,
        timezone: 'Mars/Olympus',
      } } })],
    } as never)).toThrow('timezone is invalid');

    const element = schedulingElement({ settings: { scheduling: {
      ...schedulingElement().settings.scheduling,
      availability: [
        { id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '11:00' },
        { id: 'window-2', date: '2026-06-24', startTime: '10:00', endTime: '12:00' },
      ],
    } } });
    expect(() => service.validatePollInput({ title: 'Poll', elements: [element] } as never)).toThrow('overlap');
  });

  it('preserves schedule seconds instead of truncating them', () => {
    const service = new PollMutationOptionsService({ listLinkableEvents: jest.fn() } as never);
    const schedule = service.resolvePollPublicationSchedule({
      visibleFrom: '2026-06-24T09:00:59.900Z',
    } as never);
    expect(schedule.visibleFrom?.toISOString()).toBe('2026-06-24T09:00:59.900Z');
  });
});
