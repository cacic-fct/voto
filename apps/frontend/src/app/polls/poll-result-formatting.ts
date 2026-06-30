import {
  PollAnswerValue,
  PollElement,
  PollResponseAnswer,
  PollResultsResponse,
  PollSchedulingAnswer,
  PollSchedulingAvailabilityWindow,
  PollSchedulingSettings,
} from '@org/voting-contracts';

export type PollSchedulingSlot = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  windowId: string;
  label: string;
  fullLabel: string;
  durationMinutes: number;
};

export type ResultElementVersion = {
  key: string;
  element: PollElement;
};

export type ResultAnswerEntry = {
  response: PollResultsResponse;
  answer: PollResponseAnswer;
  element: PollElement;
  value: PollAnswerValue | undefined;
};

export function isAnswerElement(element: PollElement): boolean {
  return element.type !== 'section' && element.type !== 'statement';
}

export function collectResultElementVersions(
  currentElements: readonly PollElement[],
  responses: readonly PollResultsResponse[],
): ResultElementVersion[] {
  const fallbackElements = new Map(currentElements.map((element) => [element.id, element]));
  const versions = new Map<string, PollElement>();

  for (const element of currentElements) {
    if (isAnswerElement(element)) {
      versions.set(resultElementVersionKey(element), element);
    }
  }

  for (const response of responses) {
    for (const answer of response.answers) {
      const element = resolveAnswerElement(answer, fallbackElements);
      if (element && isAnswerElement(element)) {
        versions.set(resultElementVersionKey(element), element);
      }
    }
  }

  return [...versions.entries()].map(([key, element]) => ({ key, element }));
}

export function collectAnswerEntriesForElementVersion(
  versionKey: string,
  currentElements: readonly PollElement[],
  responses: readonly PollResultsResponse[],
): ResultAnswerEntry[] {
  const fallbackElements = new Map(currentElements.map((element) => [element.id, element]));
  const entries: ResultAnswerEntry[] = [];

  for (const response of responses) {
    for (const answer of response.answers) {
      const element = resolveAnswerElement(answer, fallbackElements);
      if (!element || resultElementVersionKey(element) !== versionKey) {
        continue;
      }

      entries.push({
        response,
        answer,
        element,
        value: answer.value,
      });
    }
  }

  return entries;
}

export function resultElementVersionKey(element: PollElement): string {
  return JSON.stringify({
    id: element.id,
    type: element.type,
    title: element.title,
    description: element.description ?? null,
    required: element.required,
    options: element.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description ?? null,
    })),
    settings: element.settings ?? null,
  });
}

export function answerValueLabel(
  element: PollElement,
  value: PollAnswerValue | undefined,
  options: { includeSchedulingInvitees?: boolean } = {},
): string {
  if (isEmptyAnswerValue(value)) {
    return 'Sem resposta';
  }

  if (typeof value === 'number') {
    return new Intl.NumberFormat('pt-BR').format(value);
  }

  if (typeof value === 'string') {
    return optionLabel(element, value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((optionId) => optionLabel(element, optionId) ?? optionId).join(', ');
  }

  const recordValue = asRecord(value);
  if (recordValue && element.settings?.grid) {
    return element.settings.grid.rows
      .map((row) => {
        const rawValue = recordValue[row.id];
        const rowValue = Array.isArray(rawValue)
          ? rawValue.map((columnId) => gridColumnLabel(element, String(columnId))).join(', ')
          : typeof rawValue === 'string'
            ? gridColumnLabel(element, rawValue)
            : '';
        return rowValue ? `${row.label}: ${rowValue}` : '';
      })
      .filter(Boolean)
      .join('; ');
  }

  if (recordValue && element.type === 'scheduling') {
    const answer = readSchedulingAnswerOrNull(recordValue);
    if (!answer) {
      return 'Sem resposta';
    }

    const slot = schedulingSlots(element).find((item) => item.id === answer.slotId);
    const inviteeLabel =
      options.includeSchedulingInvitees !== false && answer.invitees.length > 0
        ? ` · Convidados: ${answer.invitees.map((invitee) => invitee.email ? `${invitee.name} (${invitee.email})` : invitee.name).join(', ')}`
        : '';

    return `${slot?.fullLabel ?? answer.slotId}${inviteeLabel}`;
  }

  return 'Sem resposta';
}

export function answerValueLabels(element: PollElement, value: PollAnswerValue | undefined): string[] {
  if (typeof value === 'number') {
    return [String(value)];
  }

  if (typeof value === 'string') {
    return [optionLabel(element, value) ?? value];
  }

  if (Array.isArray(value)) {
    return value.map((optionId) => optionLabel(element, optionId) ?? optionId);
  }

  const recordValue = asRecord(value);
  if (!recordValue) {
    return [];
  }

  if (element.settings?.grid) {
    return element.settings.grid.rows.flatMap((row) => {
      const rawValue = recordValue[row.id];
      if (Array.isArray(rawValue)) {
        return rawValue.map((columnId) => `${row.label}: ${gridColumnLabel(element, String(columnId))}`);
      }

      return typeof rawValue === 'string' ? [`${row.label}: ${gridColumnLabel(element, rawValue)}`] : [];
    });
  }

  if (element.type === 'scheduling') {
    const answer = readSchedulingAnswer(recordValue);
    const slot = schedulingSlots(element).find((item) => item.id === answer.slotId);
    return answer.slotId ? [slot?.fullLabel ?? answer.slotId] : [];
  }

  return [];
}

export function isEmptyAnswerValue(value: PollAnswerValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (asRecord(value) !== null && Object.keys(value).length === 0)
  );
}

export function readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
  return readSchedulingAnswerOrNull(value) ?? {
    slotId: '',
    invitees: [],
  };
}

export function readSchedulingAnswerOrNull(value: unknown): PollSchedulingAnswer | null {
  const recordValue = asRecord(value);
  if (!recordValue) {
    return null;
  }

  const slotId = typeof recordValue['slotId'] === 'string' ? recordValue['slotId'] : '';
  if (!slotId) {
    return null;
  }

  const invitees = Array.isArray(recordValue['invitees'])
    ? recordValue['invitees']
        .map((invitee) => asRecord(invitee))
        .filter((invitee): invitee is Record<string, unknown> => invitee !== null)
        .map((invitee) => ({
          name: typeof invitee['name'] === 'string' ? invitee['name'] : '',
          email: typeof invitee['email'] === 'string' ? invitee['email'] : undefined,
        }))
        .filter((invitee) => invitee.name.trim().length > 0)
    : [];

  return {
    slotId,
    invitees,
  };
}

export function schedulingSlots(element: PollElement): PollSchedulingSlot[] {
  const settings = element.settings?.scheduling;
  if (!settings) {
    return [];
  }

  return settings.availability.flatMap((availability) => schedulingSlotsForAvailability(settings, availability));
}

export function formatDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }

  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  return `${weekday.replace('.', '')}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatTimeMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resolveAnswerElement(
  answer: PollResponseAnswer,
  fallbackElements: ReadonlyMap<string, PollElement>,
): PollElement | null {
  return answer.element ?? fallbackElements.get(answer.elementId) ?? null;
}

function optionLabel(element: PollElement, optionId: string): string | undefined {
  return element.options.find((option) => option.id === optionId)?.label;
}

function gridColumnLabel(element: PollElement, columnId: string): string {
  return element.settings?.grid?.columns.find((column) => column.id === columnId)?.label ?? columnId;
}

function schedulingSlotsForAvailability(
  settings: PollSchedulingSettings,
  availability: PollSchedulingAvailabilityWindow,
): PollSchedulingSlot[] {
  const slots: PollSchedulingSlot[] = [];
  const windowStart = timeToMinutes(availability.startTime);
  const windowEnd = timeToMinutes(availability.endTime);
  const firstStart = windowStart + settings.bufferBeforeMinutes;
  const lastStart = windowEnd - settings.durationMinutes - settings.bufferAfterMinutes;

  for (
    let startMinutes = firstStart;
    startMinutes <= lastStart;
    startMinutes += settings.slotIntervalMinutes
  ) {
    const endMinutes = startMinutes + settings.durationMinutes;
    const startTime = formatTimeMinutes(startMinutes);
    const endTime = formatTimeMinutes(endMinutes);
    slots.push({
      id: schedulingSlotId(availability, startMinutes),
      date: availability.date,
      startTime,
      endTime,
      windowId: availability.id,
      label: `${startTime} - ${endTime}`,
      fullLabel: `${formatDateLabel(availability.date)} · ${startTime} - ${endTime}`,
      durationMinutes: settings.durationMinutes,
    });
  }

  return slots;
}

function schedulingSlotId(availability: PollSchedulingAvailabilityWindow, startMinutes: number): string {
  return `${availability.id}:${formatTimeMinutes(startMinutes)}`;
}
