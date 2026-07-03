import { PollElement, PollResultsResponse } from '@org/voting-contracts';
import { describe, expect, it } from 'vitest';
import {
  answerValueLabel,
  answerValueLabels,
  asRecord,
  collectAnswerEntriesForElementVersion,
  collectResultElementVersions,
  formatDateLabel,
  formatTimeMinutes,
  isAnswerElement,
  isEmptyAnswerValue,
  readSchedulingAnswer,
  readSchedulingAnswerOrNull,
  resultElementVersionKey,
  schedulingSlots,
  timeToMinutes,
} from './poll-result-formatting';

const choiceElement: PollElement = {
  id: 'choice',
  type: 'singleChoice',
  title: 'Escolha',
  description: 'Descrição',
  required: true,
  options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
};

const gridElement: PollElement = {
  id: 'grid',
  type: 'singleSelectionGrid',
  title: 'Grade',
  required: true,
  options: [],
  settings: {
    grid: {
      rows: [{ id: 'row', label: 'Linha' }, { id: 'empty', label: 'Vazia' }],
      columns: [{ id: 'col', label: 'Coluna' }],
    },
  },
};

const schedulingElement: PollElement = {
  id: 'schedule',
  type: 'scheduling',
  title: 'Agenda',
  required: false,
  options: [],
  settings: {
    scheduling: {
      hostName: 'Comissão',
      location: 'Sala',
      timezone: 'America/Sao_Paulo',
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      inviteeMode: 'optional',
      maxInvitees: 2,
      availability: [{ id: 'window', date: '2026-06-24', startTime: '09:00', endTime: '10:00' }],
    },
  },
};

describe('poll result formatting helpers', () => {
  it('collects current and historic element versions for answerable fields', () => {
    const historicElement = { ...choiceElement, title: 'Escolha antiga' };
    const responses: PollResultsResponse[] = [
      {
        id: 'response-1',
        answers: [{ elementId: 'choice', value: 'a', element: historicElement }],
      },
      {
        id: 'response-2',
        answers: [{ elementId: 'choice', value: 'b' }, { elementId: 'unknown', value: 'x' }],
      },
    ];

    expect(isAnswerElement({ ...choiceElement, type: 'section' })).toBe(false);
    expect(isAnswerElement({ ...choiceElement, type: 'statement' })).toBe(false);
    expect(isAnswerElement(choiceElement)).toBe(true);
    expect(collectResultElementVersions([choiceElement], responses).map((version) => version.element.title)).toEqual([
      'Escolha',
      'Escolha antiga',
    ]);
    expect(
      collectAnswerEntriesForElementVersion(resultElementVersionKey(choiceElement), [choiceElement], responses).map(
        (entry) => entry.value,
      ),
    ).toEqual(['b']);
    expect(collectAnswerEntriesForElementVersion(resultElementVersionKey(historicElement), [choiceElement], responses)[0]).toMatchObject({
      response: responses[0],
      answer: responses[0].answers[0],
      element: historicElement,
      value: 'a',
    });
    expect(collectAnswerEntriesForElementVersion('missing', [choiceElement], responses)).toEqual([]);
  });

  it('formats scalar, option, grid, scheduling, and empty answer values', () => {
    expect(answerValueLabel(choiceElement, undefined)).toBe('Sem resposta');
    expect(answerValueLabel(choiceElement, 1000)).toBe('1.000');
    expect(answerValueLabel(choiceElement, 'a')).toBe('A');
    expect(answerValueLabel(choiceElement, 'custom')).toBe('custom');
    expect(answerValueLabel(choiceElement, ['a', 'custom'])).toBe('A, custom');
    expect(answerValueLabel(choiceElement, ['a', 1])).toBe('A, 1');
    expect(answerValueLabel(gridElement, { row: 'col', empty: 1 })).toBe('Linha: Coluna');
    expect(answerValueLabel(schedulingElement, { slotId: 'window:09:00', invitees: [{ name: 'Ana', email: 'ana@example.com' }] })).toContain(
      'Convidados: Ana (ana@example.com)',
    );
    expect(answerValueLabel(schedulingElement, { slotId: 'window:09:00', invitees: [{ name: 'Ana' }] })).toContain(
      'Convidados: Ana',
    );
    expect(answerValueLabel(schedulingElement, { slotId: 'window:09:00', invitees: [{ name: 'Ana' }] }, { includeSchedulingInvitees: false })).not.toContain(
      'Convidados',
    );
    expect(answerValueLabel(schedulingElement, { slotId: 'missing' })).toBe('missing');
    expect(answerValueLabel(schedulingElement, {})).toBe('Sem resposta');
    expect(answerValueLabel(choiceElement, {})).toBe('Sem resposta');
  });

  it('returns bucket labels for supported answer shapes', () => {
    expect(answerValueLabels(choiceElement, 3)).toEqual(['3']);
    expect(answerValueLabels(choiceElement, 'a')).toEqual(['A']);
    expect(answerValueLabels(choiceElement, ['a', 'custom'])).toEqual(['A', 'custom']);
    expect(answerValueLabels(gridElement, { row: ['col'], other: 'missing' })).toEqual(['Linha: Coluna']);
    expect(answerValueLabels(gridElement, { row: 'col' })).toEqual(['Linha: Coluna']);
    expect(answerValueLabels(schedulingElement, { slotId: 'window:09:00' })[0]).toContain('09:00 - 09:30');
    expect(answerValueLabels(schedulingElement, { slotId: '' })).toEqual([]);
    expect(answerValueLabels(choiceElement, null)).toEqual([]);
  });

  it('reads scheduling answers and utility values defensively', () => {
    expect(isEmptyAnswerValue(undefined)).toBe(true);
    expect(isEmptyAnswerValue(null)).toBe(true);
    expect(isEmptyAnswerValue('')).toBe(true);
    expect(isEmptyAnswerValue([])).toBe(true);
    expect(isEmptyAnswerValue({})).toBe(true);
    expect(isEmptyAnswerValue('ok')).toBe(false);
    expect(readSchedulingAnswer(null)).toEqual({ slotId: '', invitees: [] });
    expect(readSchedulingAnswerOrNull({ slotId: '' })).toBeNull();
    expect(readSchedulingAnswerOrNull({ slotId: 'slot', invitees: [{ name: ' Ana ', email: 'ana@example.com' }, { name: ' ' }, []] })).toEqual({
      slotId: 'slot',
      invitees: [{ name: ' Ana ', email: 'ana@example.com' }],
    });
    expect(schedulingSlots({ ...schedulingElement, settings: undefined })).toEqual([]);
    expect(schedulingSlots(schedulingElement)).toHaveLength(2);
    expect(formatDateLabel('bad-date')).toBe('bad-date');
    expect(formatDateLabel('2026-06-24')).toContain('24/06/2026');
    expect(timeToMinutes('09:30')).toBe(570);
    expect(formatTimeMinutes(570)).toBe('09:30');
    expect(asRecord({ value: true })).toEqual({ value: true });
    expect(asRecord([])).toBeNull();
  });
});
