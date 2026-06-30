import {
  PollAnswerValue,
  PollElement,
  PollResultsResponse,
} from '@org/voting-contracts';
import {
  answerValueLabels,
  collectAnswerEntriesForElementVersion,
  collectResultElementVersions,
  isEmptyAnswerValue,
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
): PublicQuestionResultSummary[] {
  return collectResultElementVersions(elements, responses).map((version) =>
    buildPublicQuestionSummary(version, elements, responses),
  );
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
