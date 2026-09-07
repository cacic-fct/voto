import {
  PollAnswerValue,
  PollElement,
  Poll,
  PollResultsAggregateBucket,
  PollResultsAggregate,
  PollResultsResponse,
} from '@org/voting-contracts';
import {
  answerValueLabels,
  answerValueLabel,
  collectAnswerEntriesForElementVersion,
  collectResultElementVersions,
  isEmptyAnswerValue,
  isAnswerElement,
  resultElementVersionKey,
} from './poll-result-formatting';

export type PublicResultBucket = {
  label: string;
  count: number;
};

export type PublicQuestionResultSummary = {
  key: string;
  element: PollElement;
  answeredCount: number;
  buckets: PublicResultBucket[];
  textAnswers: string[];
};

export function buildPublicQuestionSummaries(
  elements: readonly PollElement[],
  responses: PollResultsResponse[],
  aggregates: readonly PollResultsAggregate[] = [],
): PublicQuestionResultSummary[] {
  if (aggregates.length > 0) {
    const elementsById = new Map(elements.map((element) => [element.id, element]));
    return aggregates.flatMap((aggregate) => {
      const element = aggregate.elementSnapshot ?? elementsById.get(aggregate.elementId);
      if (!element || !isAnswerElement(element)) {
        return [];
      }

      return [{
        key: aggregate.versionKey ?? resultElementVersionKey(element),
        element,
        answeredCount: aggregate.answeredCount,
        buckets: (aggregate.buckets ?? [])
          .map((bucket) => ({ label: aggregateBucketLabel(element, bucket), count: bucket.count }))
          .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, 'pt-BR')),
        textAnswers: [],
      }];
    });
  }

  return collectResultElementVersions(elements, responses).map((version) =>
    buildPublicQuestionSummary(version, elements, responses),
  );
}

export function shouldShowPublicResults(poll: Poll): boolean {
  if (
    poll.mode === 'cacicElection' &&
    poll.cacicElectionPhase === 'election'
  ) {
    return poll.resultsPublic && poll.status === 'closed';
  }

  return poll.resultsPublic && (
    poll.status === 'closed' ||
    (poll.resultsLive && poll.votingStyle === 'public')
  );
}

export function resultBucketPercent(
  summary: Pick<PublicQuestionResultSummary, 'answeredCount'>,
  bucket: Pick<PublicResultBucket, 'count'>,
): number {
  return summary.answeredCount > 0
    ? Math.round((bucket.count / summary.answeredCount) * 100)
    : 0;
}

function buildPublicQuestionSummary(
  version: { key: string; element: PollElement },
  currentElements: readonly PollElement[],
  responses: PollResultsResponse[],
): PublicQuestionResultSummary {
  const element = version.element;
  const values = collectAnswerEntriesForElementVersion(version.key, currentElements, responses)
    .map((entry) => entry.value)
    .filter((value) => !isEmptyAnswerValue(value));

  return {
    key: version.key,
    element,
    answeredCount: values.length,
    buckets: buildPublicResultBuckets(element, values),
    textAnswers: buildPublicTextAnswers(element, values),
  };
}

function buildPublicResultBuckets(
  element: PollElement,
  values: (PollAnswerValue | undefined)[],
): PublicResultBucket[] {
  if (element.type === 'shortText' || element.type === 'longText') {
    return [];
  }

  const counts = new Map<string, number>();
  for (const value of values) {
    for (const label of answerValueLabels(element, value)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, 'pt-BR'));
}

function buildPublicTextAnswers(element: PollElement, values: (PollAnswerValue | undefined)[]): string[] {
  if (element.type !== 'shortText' && element.type !== 'longText') {
    return [];
  }

  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function aggregateBucketLabel(element: PollElement, bucket: PollResultsAggregateBucket): string {
  const key = bucket.key;
  const option = element.options.find((item) => item.id === key);
  if (option) {
    return option.label;
  }

  if (element.settings?.grid) {
    const coordinates = bucket.rowId !== undefined && bucket.columnId !== undefined
      ? { rowId: bucket.rowId, columnId: bucket.columnId }
      : readGridAggregateCoordinates(key);
    if (coordinates) {
      const { rowId, columnId } = coordinates;
      const row = element.settings.grid.rows.find((item) => item.id === rowId);
      const column = element.settings.grid.columns.find((item) => item.id === columnId);
      if (row && column) {
        return `${row.label}: ${column.label}`;
      }
    }
  }

  if (element.type === 'scheduling') {
    return answerValueLabel(element, { slotId: key, invitees: [] });
  }

  return answerValueLabel(element, key);
}

function readGridAggregateCoordinates(key: string): { rowId: string; columnId: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { rowId: parsed[0], columnId: parsed[1] };
    }
  } catch {
    // Legacy colon-delimited aggregate keys are handled below.
  }

  const separator = key.indexOf(':');
  return separator > 0
    ? { rowId: key.slice(0, separator), columnId: key.slice(separator + 1) }
    : undefined;
}
