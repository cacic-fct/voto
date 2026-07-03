import {
  PollAnswerValue,
  PollElement,
  PollResponseAnswer,
  PollSchedulingInvitee,
} from '@org/voting-contracts';
import { readSchedulingAnswer } from './poll-vote-scheduling';

export type AnswerValue = Exclude<PollAnswerValue, null>;
export type AnswerMap = Record<string, AnswerValue>;

export function setAnswerValue(
  answers: AnswerMap,
  elementId: string,
  value: AnswerValue,
): AnswerMap {
  return { ...answers, [elementId]: value };
}

export function toggleMultipleAnswerValue(
  answers: AnswerMap,
  elementId: string,
  optionId: string,
  checked: boolean,
): AnswerMap {
  const current = Array.isArray(answers[elementId]) ? answers[elementId] : [];
  const next = checked
    ? [...current, optionId]
    : current.filter((value) => value !== optionId);

  return { ...answers, [elementId]: next };
}

export function setSingleGridAnswerValue(
  answers: AnswerMap,
  elementId: string,
  rowId: string,
  columnId: string,
): AnswerMap {
  return {
    ...answers,
    [elementId]: {
      ...readSingleGridAnswer(answers[elementId]),
      [rowId]: columnId,
    },
  };
}

export function toggleMultipleGridAnswerValue(
  answers: AnswerMap,
  elementId: string,
  rowId: string,
  columnId: string,
  checked: boolean,
): AnswerMap {
  const current = readMultipleGridAnswer(answers[elementId]);
  const rowValues = current[rowId] ?? [];
  const nextRowValues = checked
    ? [...rowValues, columnId]
    : rowValues.filter((value) => value !== columnId);

  return {
    ...answers,
    [elementId]: {
      ...current,
      [rowId]: nextRowValues,
    },
  };
}

export function setSchedulingSlotAnswer(
  answers: AnswerMap,
  elementId: string,
  slotId: string,
): AnswerMap {
  const current = readSchedulingAnswer(answers[elementId]);
  return {
    ...answers,
    [elementId]: {
      ...current,
      slotId,
    },
  };
}

export function setSchedulingInviteeAnswer(
  answers: AnswerMap,
  elementId: string,
  index: number,
  field: keyof PollSchedulingInvitee,
  value: string,
): AnswerMap {
  const current = readSchedulingAnswer(answers[elementId]);
  const invitees = [...current.invitees];
  invitees[index] = {
    ...invitees[index],
    [field]: value,
  };

  return {
    ...answers,
    [elementId]: {
      ...current,
      invitees,
    },
  };
}

export function responseAnswersToAnswerMap(
  answers: readonly PollResponseAnswer[],
): AnswerMap {
  return answers.reduce<AnswerMap>((currentAnswers, answer) => {
    if (answer.value !== null) {
      currentAnswers[answer.elementId] = answer.value;
    }

    return currentAnswers;
  }, {});
}

export function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

export function linearScaleValues(element: PollElement): number[] {
  const min = element.settings?.linearScale?.min ?? 1;
  const max = element.settings?.linearScale?.max ?? 5;
  return range(min, max);
}

export function starRatingValues(element: PollElement): number[] {
  return range(1, element.settings?.starRating?.max ?? 5);
}

export function isNumberAnswerSelected(
  answers: AnswerMap,
  elementId: string,
  value: number,
): boolean {
  return answers[elementId] === value;
}

export function textAnswerValue(answers: AnswerMap, elementId: string): string {
  const value = answers[elementId];
  return typeof value === 'string' ? value : '';
}

export function singleAnswerValue(answers: AnswerMap, elementId: string): string {
  const value = answers[elementId];
  return typeof value === 'string' ? value : '';
}

export function isSingleAnswerSelected(
  answers: AnswerMap,
  elementId: string,
  optionId: string,
): boolean {
  return answers[elementId] === optionId;
}

export function isMultipleAnswerSelected(
  answers: AnswerMap,
  elementId: string,
  optionId: string,
): boolean {
  const value = answers[elementId];
  return Array.isArray(value) && value.includes(optionId);
}

export function isRatingFilled(
  answers: AnswerMap,
  elementId: string,
  value: number,
): boolean {
  const answer = answers[elementId];
  return typeof answer === 'number' && answer >= value;
}

export function isRatingValueSelected(
  answers: AnswerMap,
  elementId: string,
  value: number,
): boolean {
  return answers[elementId] === value;
}

export function ratingOptionLabel(
  answers: AnswerMap,
  elementId: string,
  value: number,
): string {
  return isRatingValueSelected(answers, elementId, value)
    ? `${value} estrelas selecionadas`
    : `${value} estrelas`;
}

export function isSingleGridColumnSelected(
  answers: AnswerMap,
  elementId: string,
  rowId: string,
  columnId: string,
): boolean {
  return readSingleGridAnswer(answers[elementId])[rowId] === columnId;
}

export function isMultipleGridColumnSelected(
  answers: AnswerMap,
  elementId: string,
  rowId: string,
  columnId: string,
): boolean {
  return readMultipleGridAnswer(answers[elementId])[rowId]?.includes(columnId) ?? false;
}

export function gridTemplateColumns(element: PollElement): string {
  const columnCount = Math.max(element.settings?.grid?.columns.length ?? 0, 1);
  return `minmax(10rem, 1.2fr) repeat(${columnCount}, minmax(7rem, 1fr))`;
}

export function readSingleGridAnswer(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((answer, [rowId, columnId]) => {
    if (typeof columnId === 'string') {
      answer[rowId] = columnId;
    }

    return answer;
  }, {});
}

export function readMultipleGridAnswer(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string[]>>((answer, [rowId, columnIds]) => {
    if (Array.isArray(columnIds)) {
      answer[rowId] = columnIds.filter((columnId): columnId is string => typeof columnId === 'string');
    }

    return answer;
  }, {});
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
