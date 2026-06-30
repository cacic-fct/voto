import { BadRequestException } from '@nestjs/common';
import {
  PollChoiceOption,
  PollResponseAnswer,
  PollSchedulingAvailabilityWindow,
  PollSchedulingInvitee,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import { SubmitPollResponseDto } from './dto/poll.dto';
import { readElementSettings, toContractElementType } from './poll-contract.mapper';
import { ElementRecord, PollRecord } from './poll-records';
import { isRecord } from './poll-user-claims';

export function validatePollResponse(poll: PollRecord, input: SubmitPollResponseDto): PollResponseAnswer[] {
  const answersByElementId = new Map(input.answers.map((answer) => [answer.elementId, answer.value]));
  const elementIds = new Set(poll.elements.map((element) => element.id));
  const normalizedAnswers: PollResponseAnswer[] = [];

  for (const answer of input.answers) {
    if (!elementIds.has(answer.elementId)) {
      throw new BadRequestException(`Unknown element id: ${answer.elementId}.`);
    }
  }

  for (const element of poll.elements) {
    const rawValue = answersByElementId.get(element.id) ?? null;
    const value = normalizeAnswer(element, rawValue);

    if (element.required && isEmptyAnswer(value)) {
      throw new BadRequestException(`Required element was not answered: ${element.title}.`);
    }

    if (!isEmptyAnswer(value)) {
      normalizedAnswers.push({
        elementId: element.id,
        value,
      });
    }
  }

  return normalizedAnswers;
}

export function normalizeAnswer(element: ElementRecord, rawValue: unknown): PollResponseAnswer['value'] {
  switch (toContractElementType(element.type)) {
    case 'section':
    case 'statement':
      return null;
    case 'shortText':
    case 'longText':
      return typeof rawValue === 'string' ? rawValue.trim() : null;
    case 'singleChoice':
    case 'selectionDropdown':
      return normalizeSingleChoiceAnswer(element, rawValue);
    case 'multipleChoice':
      return normalizeMultipleChoiceAnswer(element, rawValue);
    case 'singleSelectionGrid':
      return normalizeSingleSelectionGridAnswer(element, rawValue);
    case 'multipleSelectionGrid':
      return normalizeMultipleSelectionGridAnswer(element, rawValue);
    case 'linearScale':
      return normalizeBoundedNumberAnswer(element, rawValue);
    case 'starRating':
      return normalizeStarRatingAnswer(element, rawValue);
    case 'date':
      return normalizeDateAnswer(element, rawValue);
    case 'time':
      return normalizeTimeAnswer(element, rawValue);
    case 'scheduling':
      return normalizeSchedulingAnswer(element, rawValue);
  }
}

function normalizeSingleChoiceAnswer(element: ElementRecord, rawValue: unknown): string | null {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const optionIds = new Set(element.options.map((option) => option.id));
  if (!optionIds.has(rawValue)) {
    throw new BadRequestException(`Invalid option for element: ${element.title}.`);
  }

  return rawValue;
}

function normalizeMultipleChoiceAnswer(element: ElementRecord, rawValue: unknown): string[] | null {
  if (!Array.isArray(rawValue)) {
    return null;
  }

  const optionIds = new Set(element.options.map((option) => option.id));
  const selected = [...new Set(rawValue.filter((value) => typeof value === 'string' && value.trim()))];

  for (const optionId of selected) {
    if (!optionIds.has(optionId)) {
      throw new BadRequestException(`Invalid option for element: ${element.title}.`);
    }
  }

  return selected.length > 0 ? selected : null;
}

function normalizeSingleSelectionGridAnswer(
  element: ElementRecord,
  rawValue: unknown,
): Record<string, string> | null {
  const grid = readElementSettings(element).grid;
  if (!grid || !isRecord(rawValue)) {
    return null;
  }

  const rowIds = new Set(grid.rows.map((row) => row.id));
  const columnIds = new Set(grid.columns.map((column) => column.id));
  const selected: Record<string, string> = {};

  for (const [rowId, columnId] of Object.entries(rawValue)) {
    if (!rowIds.has(rowId)) {
      throw new BadRequestException(`Invalid row for element: ${element.title}.`);
    }

    if (typeof columnId !== 'string' || !columnId.trim()) {
      continue;
    }

    if (!columnIds.has(columnId)) {
      throw new BadRequestException(`Invalid column for element: ${element.title}.`);
    }

    selected[rowId] = columnId;
  }

  ensureRequiredGridRows(element, grid.rows, selected);
  return Object.keys(selected).length > 0 ? selected : null;
}

function normalizeMultipleSelectionGridAnswer(
  element: ElementRecord,
  rawValue: unknown,
): Record<string, string[]> | null {
  const grid = readElementSettings(element).grid;
  if (!grid || !isRecord(rawValue)) {
    return null;
  }

  const rowIds = new Set(grid.rows.map((row) => row.id));
  const columnIds = new Set(grid.columns.map((column) => column.id));
  const selected: Record<string, string[]> = {};

  for (const [rowId, columnValues] of Object.entries(rawValue)) {
    if (!rowIds.has(rowId)) {
      throw new BadRequestException(`Invalid row for element: ${element.title}.`);
    }

    if (!Array.isArray(columnValues)) {
      continue;
    }

    const selectedColumns = [...new Set(columnValues.filter((value) => typeof value === 'string' && value.trim()))];
    for (const columnId of selectedColumns) {
      if (!columnIds.has(columnId)) {
        throw new BadRequestException(`Invalid column for element: ${element.title}.`);
      }
    }

    if (selectedColumns.length > 0) {
      selected[rowId] = selectedColumns;
    }
  }

  ensureRequiredGridRows(element, grid.rows, selected);
  return Object.keys(selected).length > 0 ? selected : null;
}

export function ensureRequiredGridRows(
  element: Pick<ElementRecord, 'required' | 'title'>,
  rows: readonly PollChoiceOption[],
  selected: Record<string, string | string[]>,
): void {
  if (!element.required) {
    return;
  }

  const unansweredRow = rows.find((row) => {
    const value = selected[row.id];
    return value === undefined || (Array.isArray(value) && value.length === 0) || value === '';
  });

  if (unansweredRow) {
    throw new BadRequestException(`Required grid row was not answered: ${unansweredRow.label}.`);
  }
}

function normalizeBoundedNumberAnswer(element: ElementRecord, rawValue: unknown): number | null {
  const scale = readElementSettings(element).linearScale;
  const value = parseNumberAnswer(element, rawValue);
  if (value === null) {
    return null;
  }

  if (!scale || value < scale.min || value > scale.max) {
    throw new BadRequestException(`Invalid value for element: ${element.title}.`);
  }

  return value;
}

function normalizeStarRatingAnswer(element: ElementRecord, rawValue: unknown): number | null {
  const rating = readElementSettings(element).starRating;
  const value = parseNumberAnswer(element, rawValue);
  if (value === null) {
    return null;
  }

  if (!rating || value < 1 || value > rating.max) {
    throw new BadRequestException(`Invalid rating for element: ${element.title}.`);
  }

  return value;
}

function parseNumberAnswer(element: ElementRecord, rawValue: unknown): number | null {
  if (rawValue === null || rawValue === '') {
    return null;
  }

  const value =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && rawValue.trim()
        ? Number(rawValue)
        : Number.NaN;

  if (!Number.isInteger(value)) {
    throw new BadRequestException(`Invalid number for element: ${element.title}.`);
  }

  return value;
}

function normalizeDateAnswer(element: ElementRecord, rawValue: unknown): string | null {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const value = rawValue.trim();
  parseDateAnswerValue(element.title, value);
  return value;
}

function normalizeTimeAnswer(element: ElementRecord, rawValue: unknown): string | null {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const value = rawValue.trim();
  parseTimeAnswerValue(element.title, value);
  return value;
}

function normalizeSchedulingAnswer(element: ElementRecord, rawValue: unknown): PollResponseAnswer['value'] {
  const settings = readElementSettings(element).scheduling;
  if (!settings || !isRecord(rawValue)) {
    return null;
  }

  const slotId = typeof rawValue['slotId'] === 'string' ? rawValue['slotId'].trim() : '';
  if (!slotId) {
    return null;
  }

  const validSlotIds = new Set(buildSchedulingSlots(settings).map((slot) => slot.id));
  if (!validSlotIds.has(slotId)) {
    throw new BadRequestException(`Invalid scheduling slot for element: ${element.title}.`);
  }

  return {
    slotId,
    invitees: normalizeSchedulingInvitees(element, settings, rawValue['invitees']),
  };
}

function normalizeSchedulingInvitees(
  element: ElementRecord,
  settings: PollSchedulingSettings,
  rawInvitees: unknown,
): PollSchedulingInvitee[] {
  if (settings.inviteeMode === 'none') {
    return [];
  }

  if (rawInvitees !== undefined && !Array.isArray(rawInvitees)) {
    throw new BadRequestException(`Invalid invitees for element: ${element.title}.`);
  }

  const invitees = (Array.isArray(rawInvitees) ? rawInvitees : [])
    .map((rawInvitee) => normalizeSchedulingInvitee(element, rawInvitee))
    .filter((invitee): invitee is PollSchedulingInvitee => invitee !== null);

  if (invitees.length > settings.maxInvitees) {
    throw new BadRequestException(`Too many invitees for element: ${element.title}.`);
  }

  if (settings.inviteeMode === 'required' && invitees.length === 0) {
    throw new BadRequestException(`At least one invitee is required for element: ${element.title}.`);
  }

  return invitees;
}

function normalizeSchedulingInvitee(element: ElementRecord, rawInvitee: unknown): PollSchedulingInvitee | null {
  if (!isRecord(rawInvitee)) {
    return null;
  }

  const name = typeof rawInvitee['name'] === 'string' ? rawInvitee['name'].trim() : '';
  const email = typeof rawInvitee['email'] === 'string' ? rawInvitee['email'].trim() : '';
  if (!name && !email) {
    return null;
  }

  if (!name) {
    throw new BadRequestException(`Invitee name is required for element: ${element.title}.`);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException(`Invitee email is invalid for element: ${element.title}.`);
  }

  return {
    name,
    ...(email ? { email } : {}),
  };
}

export function buildSchedulingSlots(settings: PollSchedulingSettings): { id: string }[] {
  const slots: { id: string }[] = [];
  const requiredMinutes = settings.bufferBeforeMinutes + settings.durationMinutes + settings.bufferAfterMinutes;

  for (const availability of settings.availability) {
    const windowStart = parseTimeAnswerValue('scheduling availability', availability.startTime);
    const windowEnd = parseTimeAnswerValue('scheduling availability', availability.endTime);
    const firstStart = windowStart + settings.bufferBeforeMinutes;
    const lastStart = windowEnd - settings.durationMinutes - settings.bufferAfterMinutes;

    if (windowEnd - windowStart < requiredMinutes) {
      continue;
    }

    for (let startMinutes = firstStart; startMinutes <= lastStart; startMinutes += settings.slotIntervalMinutes) {
      slots.push({ id: schedulingSlotId(availability, startMinutes) });
    }
  }

  return slots;
}

function schedulingSlotId(availability: PollSchedulingAvailabilityWindow, startMinutes: number): string {
  return `${availability.id}:${formatTimeMinutes(startMinutes)}`;
}

export function parseDateAnswerValue(elementTitle: string, value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException(`Invalid date for element: ${elementTitle}.`);
  }

  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException(`Invalid date for element: ${elementTitle}.`);
  }
}

export function parseTimeAnswerValue(elementTitle: string, value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BadRequestException(`Invalid time for element: ${elementTitle}.`);
  }

  return timeToMinutes(value);
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTimeMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isEmptyAnswer(value: unknown): boolean {
  return (
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}
