import {
  PollAnswerValue,
  PollElement,
  PollResultsResponse,
} from '@org/voting-contracts';
import {
  answerValueLabel,
  asRecord,
  collectAnswerEntriesForElementVersion,
  collectResultElementVersions,
  isEmptyAnswerValue,
  readSchedulingAnswerOrNull,
  schedulingSlots,
} from '../polls/poll-result-formatting';
import {
  AdminResultsChartConfig,
  AdminResultsChartType,
} from './admin-results-chart.component';

export type ResultsVoterRow = {
  response: PollResultsResponse;
  name: string;
  email: string;
  unespRole: string;
  enrollmentNumber: string;
  enrollmentYear: string;
  course: string;
};

export type QuestionResultSummary = {
  key: string;
  element: PollElement;
  answeredCount: number;
  charts: AdminResultsChartConfig[];
  textAnswers: string[];
  individualAnswers: {
    responseId: string;
    voterLabel: string;
    valueLabel: string;
  }[];
};

export type SelectedIndividualAnswer = {
  element: PollElement;
  valueLabel: string;
};

export function buildQuestionSummaries(
  elements: PollElement[],
  responses: PollResultsResponse[],
): QuestionResultSummary[] {
  return collectResultElementVersions(elements, responses).map((version) =>
    buildQuestionSummary(version, elements, responses),
  );
}

export function buildAnswerSummaryCharts(summaries: QuestionResultSummary[]): AdminResultsChartConfig[] {
  return summaries.flatMap((summary) =>
    summary.charts.slice(0, summary.element.type.includes('Grid') ? 2 : 1),
  );
}

export function buildTextQuestionSummaries(summaries: QuestionResultSummary[]): QuestionResultSummary[] {
  return summaries.filter((summary) => summary.textAnswers.length > 0);
}

export function toVoterRows(responses: PollResultsResponse[]): ResultsVoterRow[] {
  return responses.map((response) => toVoterRow(response));
}

export function buildDemographicsCharts(
  rows: ResultsVoterRow[],
  individualResultsAvailable: boolean,
): AdminResultsChartConfig[] {
  if (rows.length === 0 || !individualResultsAvailable) {
    return [];
  }

  return [
    {
      title: 'Vínculo Unesp',
      subtitle: 'Distribuição por unespRole informado no login.',
      icon: 'badge',
      type: 'pie',
      buckets: countBuckets(rows.map((row) => row.unespRole)),
    },
    {
      title: 'Ano de ingresso',
      subtitle: 'Calculado pelos dois primeiros dígitos da matrícula.',
      icon: 'calendar_month',
      type: 'verticalBar',
      buckets: countBuckets(rows.map((row) => row.enrollmentYear)),
    },
    {
      title: 'Curso',
      subtitle: 'Código 12 é Ciência da Computação; demais códigos ficam identificados como desconhecidos.',
      icon: 'school',
      type: 'horizontalBar',
      buckets: countBuckets(rows.map((row) => row.course)),
    },
  ];
}

export function responseVoterLabel(response: PollResultsResponse): string {
  const voter = response.voter;
  return voter?.name || voter?.preferredUsername || voter?.email || 'Identidade não disponível';
}

export function selectedIndividualAnswers(
  response: PollResultsResponse | null,
  answerElements: PollElement[],
): SelectedIndividualAnswer[] {
  if (!response) {
    return [];
  }

  const elementsById = new Map(answerElements.map((element) => [element.id, element]));
  return response.answers
    .map((answer) => {
      const element = answer.element ?? elementsById.get(answer.elementId);
      return element
        ? {
            element,
            valueLabel: answerValueLabel(element, answer.value),
          }
        : null;
    })
    .filter((answer): answer is SelectedIndividualAnswer => answer !== null);
}

function buildQuestionSummary(
  version: { key: string; element: PollElement },
  elements: PollElement[],
  responses: PollResultsResponse[],
): QuestionResultSummary {
  const element = version.element;
  const answerEntries = collectAnswerEntriesForElementVersion(version.key, elements, responses)
    .filter((entry) => !isEmptyAnswerValue(entry.value));

  return {
    key: version.key,
    element,
    answeredCount: answerEntries.length,
    charts: buildQuestionCharts(element, answerEntries.map((entry) => entry.value)),
    textAnswers: buildQuestionTextAnswers(element, answerEntries.map((entry) => entry.value)),
    individualAnswers: answerEntries.map((entry) => ({
      responseId: entry.response.id,
      voterLabel: responseVoterLabel(entry.response),
      valueLabel: answerValueLabel(element, entry.value),
    })),
  };
}

export function buildQuestionCharts(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig[] {
  switch (element.type) {
    case 'singleChoice':
    case 'selectionDropdown':
      return [
        optionChart(element, values, 'pie', 'radio_button_checked', 'Distribuição de escolhas únicas.'),
      ];
    case 'multipleChoice':
      return [optionChart(element, values, 'horizontalBar', 'check_box', 'Total por opção marcada.')];
    case 'linearScale':
    case 'starRating':
      return [scalarChart(element, values)];
    case 'date':
    case 'time':
      return [rawValueChart(element, values, 'horizontalBar', 'event', 'Frequência por resposta.')];
    case 'scheduling':
      return [schedulingChart(element, values)];
    case 'singleSelectionGrid':
    case 'multipleSelectionGrid':
      return gridCharts(element, values);
    case 'shortText':
    case 'longText':
    case 'section':
    case 'statement':
      return [];
  }
}

function buildQuestionTextAnswers(element: PollElement, values: (PollAnswerValue | undefined)[]): string[] {
  if (element.type !== 'shortText' && element.type !== 'longText') {
    return [];
  }

  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function optionChart(
  element: PollElement,
  values: (PollAnswerValue | undefined)[],
  type: AdminResultsChartType,
  icon: string,
  subtitle: string,
): AdminResultsChartConfig {
  const counts = new Map(element.options.map((option) => [option.id, 0]));

  for (const value of values) {
    if (typeof value === 'string') {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      continue;
    }

    if (Array.isArray(value)) {
      for (const optionId of value) {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
      }
    }
  }

  return {
    title: element.title,
    subtitle,
    icon,
    type,
    buckets: element.options.map((option) => ({
      label: option.label,
      value: counts.get(option.id) ?? 0,
    })),
    emptyText: 'Nenhuma resposta registrada para esta pergunta.',
  };
}

function scalarChart(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig {
  const counts = new Map<string, number>();
  const allowedValues =
    element.type === 'linearScale' && element.settings?.linearScale
      ? numberRange(element.settings.linearScale.min, element.settings.linearScale.max)
      : element.type === 'starRating' && element.settings?.starRating
        ? numberRange(1, element.settings.starRating.max)
        : [];

  for (const value of allowedValues) {
    counts.set(String(value), 0);
  }

  for (const value of values) {
    if (typeof value === 'number') {
      const label = String(value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return {
    title: element.title,
    subtitle: 'Frequência por valor selecionado.',
    icon: element.type === 'starRating' ? 'star' : 'linear_scale',
    type: 'verticalBar',
    buckets: [...counts.entries()].map(([label, value]) => ({ label, value })),
    emptyText: 'Nenhuma resposta registrada para esta pergunta.',
  };
}

function rawValueChart(
  element: PollElement,
  values: (PollAnswerValue | undefined)[],
  type: AdminResultsChartType,
  icon: string,
  subtitle: string,
): AdminResultsChartConfig {
  return {
    title: element.title,
    subtitle,
    icon,
    type,
    buckets: countBuckets(
      values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
    emptyText: 'Nenhuma resposta registrada para esta pergunta.',
  };
}

export function schedulingChart(
  element: PollElement,
  values: (PollAnswerValue | undefined)[],
): AdminResultsChartConfig {
  const slots = schedulingSlots(element).map((slot) => ({ id: slot.id, label: slot.fullLabel }));
  const labels = new Map(slots.map((slot) => [slot.id, slot.label]));
  const counts = new Map(slots.map((slot) => [slot.id, 0]));

  for (const value of values) {
    const answer = readSchedulingAnswerOrNull(value);
    if (!answer) {
      continue;
    }

    counts.set(answer.slotId, (counts.get(answer.slotId) ?? 0) + 1);
    if (!labels.has(answer.slotId)) {
      labels.set(answer.slotId, answer.slotId);
    }
  }

  return {
    title: element.title,
    subtitle: 'Total de escolhas por horário disponível.',
    icon: 'event_available',
    type: 'horizontalBar',
    buckets: [...labels.entries()].map(([slotId, label]) => ({
      label,
      value: counts.get(slotId) ?? 0,
    })),
    emptyText: 'Nenhum horário selecionado para este agendamento.',
  };
}

export function gridCharts(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig[] {
  const grid = element.settings?.grid;
  if (!grid) {
    return [];
  }

  return grid.rows.map((row) => {
    const counts = new Map(grid.columns.map((column) => [column.id, 0]));

    for (const value of values) {
      const recordValue = asRecord(value);
      if (!recordValue) {
        continue;
      }

      const rawRowValue = recordValue[row.id];
      if (typeof rawRowValue === 'string') {
        counts.set(rawRowValue, (counts.get(rawRowValue) ?? 0) + 1);
        continue;
      }

      if (Array.isArray(rawRowValue)) {
        for (const columnId of rawRowValue) {
          if (typeof columnId === 'string') {
            counts.set(columnId, (counts.get(columnId) ?? 0) + 1);
          }
        }
      }
    }

    return {
      title: `${element.title}: ${row.label}`,
      subtitle: 'Distribuição por coluna da grade.',
      icon: element.type === 'multipleSelectionGrid' ? 'checklist' : 'table_rows',
      type: 'verticalBar',
      buckets: grid.columns.map((column) => ({
        label: column.label,
        value: counts.get(column.id) ?? 0,
      })),
      emptyText: 'Nenhuma resposta registrada para esta linha.',
    } satisfies AdminResultsChartConfig;
  });
}

function toVoterRow(response: PollResultsResponse): ResultsVoterRow {
  const voter = response.voter;
  const metadata = enrollmentMetadata(voter?.enrollmentNumber);

  return {
    response,
    name: voter?.name || voter?.preferredUsername || 'Identidade não disponível',
    email: voter?.email || 'Não informado',
    unespRole: voter?.unespRole || 'Não informado',
    enrollmentNumber: voter?.enrollmentNumber || 'Não informado',
    enrollmentYear: metadata?.yearLabel ?? 'Não informado',
    course: metadata?.courseLabel ?? 'Não informado',
  };
}

export function enrollmentMetadata(enrollmentNumber?: string): { yearLabel: string; courseLabel: string } | null {
  const digits = enrollmentNumber?.replace(/\D/g, '') ?? '';
  if (digits.length < 4) {
    return null;
  }

  const enrollmentYear = 2000 + Number(digits.slice(0, 2));
  const courseCode = digits.slice(2, 4);
  const courseLabel = courseCode === '12' ? 'Ciência da Computação' : `Curso desconhecido (${courseCode})`;

  return {
    yearLabel: String(enrollmentYear),
    courseLabel,
  };
}

export function countBuckets(values: readonly string[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value.trim() || 'Não informado';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'pt-BR'));
}

export function numberRange(min: number, max: number): number[] {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}
