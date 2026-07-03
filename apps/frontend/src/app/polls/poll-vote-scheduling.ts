import {
  PollElement,
  PollSchedulingAnswer,
  PollSchedulingInvitee,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import {
  asRecord,
  formatDateLabel,
  schedulingSlots as buildSchedulingSlots,
} from './poll-result-formatting';

export type SchedulingSlotView = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  windowId: string;
  label: string;
  meta: string;
};

export type SchedulingSlotGroup = {
  date: string;
  label: string;
  slots: SchedulingSlotView[];
};

export function schedulingSlots(element: PollElement): SchedulingSlotView[] {
  return buildSchedulingSlots(element).map((slot) => ({
    id: slot.id,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    windowId: slot.windowId,
    label: slot.label,
    meta: `${slot.durationMinutes} min`,
  }));
}

export function schedulingSlotGroups(element: PollElement): SchedulingSlotGroup[] {
  const groups = new Map<string, SchedulingSlotView[]>();
  for (const slot of schedulingSlots(element)) {
    groups.set(slot.date, [...(groups.get(slot.date) ?? []), slot]);
  }

  return [...groups.entries()].map(([date, slots]) => ({
    date,
    label: formatDateLabel(date),
    slots,
  }));
}

export function schedulingInviteeIndexes(element: PollElement): number[] {
  const settings = element.settings?.scheduling;
  if (!settings || settings.inviteeMode === 'none') {
    return [];
  }

  return Array.from({ length: Math.max(0, settings.maxInvitees) }, (_, index) => index);
}

export function schedulingInviteeLabel(settings: PollSchedulingSettings): string {
  return settings.inviteeMode === 'required' ? 'Convidados obrigatórios' : 'Convidados opcionais';
}

export function readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
  const recordValue = asRecord(value);
  if (!recordValue) {
    return {
      slotId: '',
      invitees: [],
    };
  }

  const invitees = Array.isArray(recordValue['invitees'])
    ? recordValue['invitees']
        .map((invitee) => asRecord(invitee))
        .filter((invitee): invitee is Record<string, unknown> => invitee !== null)
    : [];

  return {
    slotId: typeof recordValue['slotId'] === 'string' ? recordValue['slotId'] : '',
    invitees: invitees.map(readSchedulingInvitee),
  };
}

function readSchedulingInvitee(invitee: Record<string, unknown>): PollSchedulingInvitee {
  return {
    name: typeof invitee['name'] === 'string' ? invitee['name'] : '',
    email: typeof invitee['email'] === 'string' ? invitee['email'] : '',
  };
}
