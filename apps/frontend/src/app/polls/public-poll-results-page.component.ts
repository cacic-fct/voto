import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Poll,
  PollAnswerValue,
  PollElement,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollSchedulingAnswer,
  PollSchedulingAvailabilityWindow,
  PollVotingStyle,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { votingStylePublicResultsDescription } from './poll-metadata';
import { PollApiService } from './poll-api.service';

type PublicPollAccess =
  | {
      kind: 'id';
      value: string;
    }
  | {
      kind: 'directLink';
      value: string;
    };

type ResultBucket = {
  label: string;
  count: number;
};

type QuestionResultSummary = {
  element: PollElement;
  answeredCount: number;
  buckets: ResultBucket[];
  textAnswers: string[];
};

type ResultAnswerRow = {
  question: string;
  value: string;
};

@Component({
  selector: 'app-public-poll-results-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './public-poll-results-page.component.html',
  styleUrl: './public-poll-results-page.component.scss',
})
export class PublicPollResultsPageComponent implements OnDestroy {
  private readonly api = inject(PollApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly route = inject(ActivatedRoute);
  private readonly pollAccess = this.resolvePollAccess();
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  protected readonly poll = signal<Poll | null>(null);
  protected readonly results = signal<PollResults | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly votingStylePublicResultsDescription =
    votingStylePublicResultsDescription;
  protected readonly backLink = computed(() => {
    const access = this.pollAccess;
    if (!access) {
      return '/polls';
    }

    return access.kind === 'directLink'
      ? ['/polls/direct', access.value]
      : ['/polls', access.value];
  });
  protected readonly questionSummaries = computed<QuestionResultSummary[]>(
    () => {
      const poll = this.poll();
      const results = this.results();
      if (!poll || !results || !results.answersReleased) {
        return [];
      }

      return poll.elements
        .filter((element) => this.isAnswerElement(element))
        .map((element) =>
          this.buildQuestionSummary(
            element,
            results.responses,
            poll.votingStyle,
          ),
        );
    },
  );
  protected readonly canShowParticipants = computed(() => {
    const poll = this.poll();
    return (
      Boolean(this.results()?.voters?.length) &&
      (poll?.votingStyle === 'public' || poll?.votingStyle === 'partiallySecret')
    );
  });
  protected readonly canShowIndividualResponses = computed(
    () => this.poll()?.votingStyle === 'public' && Boolean(this.results()?.responses.length),
  );
  private resultsEvents?: EventSource;

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.closeResultsEvents();
  }

  protected resultBucketPercent(
    summary: Pick<QuestionResultSummary, 'answeredCount'>,
    bucket: Pick<ResultBucket, 'count'>,
  ): number {
    return summary.answeredCount > 0
      ? Math.round((bucket.count / summary.answeredCount) * 100)
      : 0;
  }

  protected voteCountText(responseCount: number): string {
    return responseCount === 1
      ? '1 pessoa votou.'
      : `${responseCount} pessoas votaram.`;
  }

  protected responseLabel(response: PollResultsResponse, index: number): string {
    const voter = response.voter;
    if (voter?.name || voter?.preferredUsername || voter?.email) {
      return voter.name ?? voter.preferredUsername ?? voter.email ?? '';
    }

    return `Resposta ${index + 1}`;
  }

  protected responseSubtitle(response: PollResultsResponse): string {
    if (response.submittedAt) {
      return `Registrada em ${this.dateTimeFormatter.format(new Date(response.submittedAt))}`;
    }

    return 'Resposta individual';
  }

  protected responseAnswerRows(response: PollResultsResponse): ResultAnswerRow[] {
    const poll = this.poll();
    if (!poll) {
      return [];
    }

    return poll.elements
      .filter((element) => this.isAnswerElement(element))
      .map((element) => ({
        question: element.title,
        value: this.answerValueLabels(
          element,
          this.findAnswerValue(response, element.id),
        ).join(', '),
      }))
      .filter((row) => row.value.length > 0);
  }

  private async load(): Promise<void> {
    if (!this.pollAccess) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }

    try {
      const poll = await firstValueFrom(this.getPoll(this.pollAccess));
      this.poll.set(poll);
      const results = await firstValueFrom(this.getResults(poll.id));
      this.results.set(results);

      if (poll.status === 'published' && poll.resultsLive) {
        this.openResultsEvents(poll.id);
      }
    } catch {
      this.error.set(
        'Não foi possível carregar os resultados públicos desta votação.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private resolvePollAccess(): PublicPollAccess | null {
    const directLinkToken = this.route.snapshot.paramMap
      .get('directLinkToken')
      ?.trim();
    if (directLinkToken) {
      return { kind: 'directLink', value: directLinkToken };
    }

    const id = this.route.snapshot.paramMap.get('id')?.trim();
    return id ? { kind: 'id', value: id } : null;
  }

  private getPoll(access: PublicPollAccess) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPoll(access.value)
      : this.api.getPublicPoll(access.value);
  }

  private getResults(pollId: string) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.getDirectLinkPollResults(this.pollAccess.value)
      : this.api.getPublicPollResults(pollId);
  }

  private openResultsEvents(pollId: string): void {
    if (!this.isBrowser) {
      return;
    }

    const source =
      this.pollAccess?.kind === 'directLink'
        ? this.api.openDirectLinkPollResultsEvents(this.pollAccess.value, 0)
        : this.api.openPublicPollResultsEvents(pollId, 0);
    source.onmessage = (event) => {
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
      }
    };
    this.resultsEvents = source;
  }

  private closeResultsEvents(): void {
    this.resultsEvents?.close();
    this.resultsEvents = undefined;
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => {
      if (!current || current.pollId !== delta.pollId) {
        return current;
      }

      const existingResponses = new Map(
        current.responses.map((response) => [response.id, response]),
      );
      for (const response of delta.responses) {
        existingResponses.set(response.id, response);
      }

      return {
        ...current,
        answersReleased: delta.answersReleased ?? current.answersReleased,
        responseCount: delta.responseCount,
        voterCount: delta.voterCount ?? current.voterCount,
        voters: delta.voters ?? current.voters,
        responses: [...existingResponses.values()],
      };
    });
  }

  private buildQuestionSummary(
    element: PollElement,
    responses: PollResultsResponse[],
    votingStyle: PollVotingStyle,
  ): QuestionResultSummary {
    const values = responses
      .map((response) => this.findAnswerValue(response, element.id))
      .filter((value) => !this.isEmptyAnswerValue(value));

    return {
      element,
      answeredCount: values.length,
      buckets: this.buildResultBuckets(element, values),
      textAnswers: this.canShowTextAnswerSummary(votingStyle)
        ? this.buildTextAnswers(element, values)
        : [],
    };
  }

  private canShowTextAnswerSummary(votingStyle: PollVotingStyle): boolean {
    return votingStyle === 'public' || votingStyle === 'secret';
  }

  private buildResultBuckets(
    element: PollElement,
    values: (PollAnswerValue | undefined)[],
  ): ResultBucket[] {
    if (element.type === 'shortText' || element.type === 'longText') {
      return [];
    }

    const counts = new Map<string, number>();
    for (const value of values) {
      for (const label of this.answerValueLabels(element, value)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort(
        (first, second) =>
          second.count - first.count ||
          first.label.localeCompare(second.label, 'pt-BR'),
      );
  }

  private buildTextAnswers(
    element: PollElement,
    values: (PollAnswerValue | undefined)[],
  ): string[] {
    if (element.type !== 'shortText' && element.type !== 'longText') {
      return [];
    }

    return values.filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
  }

  private answerValueLabels(
    element: PollElement,
    value: PollAnswerValue | undefined,
  ): string[] {
    if (typeof value === 'number') {
      return [String(value)];
    }

    if (typeof value === 'string') {
      return [this.optionLabel(element, value) ?? value];
    }

    if (Array.isArray(value)) {
      return value.map(
        (optionId) => this.optionLabel(element, optionId) ?? optionId,
      );
    }

    const recordValue = this.asRecord(value);
    if (!recordValue) {
      return [];
    }

    if (element.settings?.grid) {
      return element.settings.grid.rows.flatMap((row) => {
        const rawValue = recordValue[row.id];
        if (Array.isArray(rawValue)) {
          return rawValue.map(
            (columnId) =>
              `${row.label}: ${this.gridColumnLabel(element, String(columnId))}`,
          );
        }

        return typeof rawValue === 'string'
          ? [`${row.label}: ${this.gridColumnLabel(element, rawValue)}`]
          : [];
      });
    }

    if (element.type === 'scheduling') {
      const answer = this.readSchedulingAnswer(recordValue);
      const slot = this.schedulingSlots(element).find(
        (item) => item.id === answer.slotId,
      );
      return answer.slotId ? [slot?.label ?? answer.slotId] : [];
    }

    return [];
  }

  private findAnswerValue(
    response: PollResultsResponse,
    elementId: string,
  ): PollAnswerValue | undefined {
    return response.answers.find((answer) => answer.elementId === elementId)
      ?.value;
  }

  private optionLabel(
    element: PollElement,
    optionId: string,
  ): string | undefined {
    return element.options.find((option) => option.id === optionId)?.label;
  }

  private gridColumnLabel(element: PollElement, columnId: string): string {
    return (
      element.settings?.grid?.columns.find((column) => column.id === columnId)
        ?.label ?? columnId
    );
  }

  private isAnswerElement(element: PollElement): boolean {
    return element.type !== 'section' && element.type !== 'statement';
  }

  private isEmptyAnswerValue(value: PollAnswerValue | undefined): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (this.isRecord(value) && Object.keys(value).length === 0)
    );
  }

  private schedulingSlots(element: PollElement): { id: string; label: string }[] {
    const settings = element.settings?.scheduling;
    if (!settings) {
      return [];
    }

    const slots: { id: string; label: string }[] = [];
    for (const availability of settings.availability) {
      const windowStart = this.timeToMinutes(availability.startTime);
      const windowEnd = this.timeToMinutes(availability.endTime);
      const firstStart = windowStart + settings.bufferBeforeMinutes;
      const lastStart =
        windowEnd - settings.durationMinutes - settings.bufferAfterMinutes;

      for (
        let startMinutes = firstStart;
        startMinutes <= lastStart;
        startMinutes += settings.slotIntervalMinutes
      ) {
        const endMinutes = startMinutes + settings.durationMinutes;
        slots.push({
          id: this.schedulingSlotId(availability, startMinutes),
          label: `${this.formatTimeMinutes(startMinutes)} - ${this.formatTimeMinutes(endMinutes)}`,
        });
      }
    }

    return slots;
  }

  private readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
    const recordValue = this.asRecord(value);
    return {
      slotId: typeof recordValue?.['slotId'] === 'string' ? recordValue['slotId'] : '',
      invitees: [],
    };
  }

  private schedulingSlotId(
    availability: PollSchedulingAvailabilityWindow,
    startMinutes: number,
  ): string {
    return `${availability.id}:${this.formatTimeMinutes(startMinutes)}`;
  }

  private timeToMinutes(value: string): number {
    const [hours = '0', minutes = '0'] = value.split(':');
    return Number(hours) * 60 + Number(minutes);
  }

  private formatTimeMinutes(value: number): string {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
