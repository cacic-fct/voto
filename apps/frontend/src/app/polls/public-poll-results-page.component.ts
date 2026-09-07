import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, ParamMap, RouterLink } from '@angular/router';
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
import { firstValueFrom, of } from 'rxjs';
import { votingStylePublicResultsDescription } from './poll-metadata';
import { PollApiService } from './poll-api.service';
import { buildPublicQuestionSummaries } from './poll-public-results';
import { answerValueLabel, isAnswerElement, isEmptyAnswerValue } from './poll-result-formatting';
import { reconcilePollResults } from './poll-results-reconciliation';

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
  key: string;
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
  private readonly routeParamMap = toSignal(
    this.route.paramMap ?? of(this.route.snapshot.paramMap),
    { initialValue: this.route.snapshot.paramMap },
  );
  private readonly pollAccess = computed(() => this.resolvePollAccess(this.routeParamMap()));
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  protected readonly poll = signal<Poll | null>(null);
  protected readonly results = signal<PollResults | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly resultsConnectionState = signal<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  protected readonly resultsFinalizationState = signal<'idle' | 'pending' | 'failed' | 'complete'>('idle');
  protected readonly resultsFinalizationError = signal<string | null>(null);
  protected readonly pendingFinalResultsPollId = signal<string | null>(null);
  protected readonly votingStylePublicResultsDescription =
    votingStylePublicResultsDescription;
  protected readonly backLink = computed(() => {
    const access = this.pollAccess();
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

      return buildPublicQuestionSummaries(
        poll.elements,
        results.responses,
        results.aggregates ?? [],
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
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private loadGeneration = 0;
  private resultsRequestRevision = 0;

  constructor() {
    effect(() => {
      const access = this.pollAccess();
      void this.load(access);
    });
  }

  ngOnDestroy(): void {
    this.loadGeneration += 1;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.closeResultsEvents();
  }

  protected retryLoad(): void {
    this.closeResultsEvents();
    this.error.set(null);
    this.loading.set(true);
    void this.load(this.pollAccess());
  }

  protected retryFinalResults(): void {
    const pollId = this.pendingFinalResultsPollId();
    const poll = this.poll();
    if (!pollId || !poll || poll.id !== pollId) {
      return;
    }

    this.resultsFinalizationState.set('pending');
    this.resultsFinalizationError.set(null);
    void this.reconcileFinalResults(pollId, this.loadGeneration);
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

    const currentElementsById = new Map(poll.elements.map((element) => [element.id, element]));
    return response.answers
      .map((answer) => {
        const element = answer.element ?? currentElementsById.get(answer.elementId);
        if (!element || !isAnswerElement(element) || isEmptyAnswerValue(answer.value)) {
          return null;
        }

        return {
          question: element.title,
          value: answerValueLabel(element, answer.value, { includeSchedulingInvitees: false }),
        };
      })
      .filter((row): row is ResultAnswerRow => row !== null)
      .filter((row) => row.value.length > 0);
  }

  private async load(access: PublicPollAccess | null): Promise<void> {
    const generation = ++this.loadGeneration;
    this.resultsRequestRevision += 1;
    this.closeResultsEvents();
    this.poll.set(null);
    this.results.set(null);
    this.resultsFinalizationState.set('idle');
    this.resultsFinalizationError.set(null);
    this.pendingFinalResultsPollId.set(null);
    this.resultsConnectionState.set('connecting');
    this.error.set(null);
    this.loading.set(true);

    if (!access) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }

    try {
      const poll = await firstValueFrom(this.getPoll(access));
      if (!this.isLoadCurrent(generation)) {
        return;
      }
      this.poll.set(poll);
      const results = await firstValueFrom(this.getResults(access, poll.id));
      if (!this.isLoadCurrent(generation)) {
        return;
      }
      this.results.set(results);

      if (poll.status === 'published' && poll.resultsLive && poll.votingStyle === 'public') {
        this.openResultsEvents(access, poll.id, generation);
      }
    } catch (error: unknown) {
      if (this.isLoadCurrent(generation)) {
        this.error.set(this.resultLoadErrorMessage(error));
      }
    } finally {
      if (this.isLoadCurrent(generation)) {
        this.loading.set(false);
      }
    }
  }

  private resolvePollAccess(paramMap: ParamMap): PublicPollAccess | null {
    const directLinkToken = paramMap
      .get('directLinkToken')
      ?.trim();
    if (directLinkToken) {
      return { kind: 'directLink', value: directLinkToken };
    }

    const id = paramMap.get('id')?.trim();
    return id ? { kind: 'id', value: id } : null;
  }

  private getPoll(access: PublicPollAccess) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPoll(access.value)
      : this.api.getPublicPoll(access.value);
  }

  private getResults(access: PublicPollAccess, pollId: string) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPollResults(access.value)
      : this.api.getPublicPollResults(pollId);
  }

  private openResultsEvents(
    accessOrPollId: PublicPollAccess | string,
    pollIdOrGeneration?: string | number,
    generationArgument?: number,
  ): void {
    if (!this.isBrowser) {
      return;
    }

    const access = typeof accessOrPollId === 'string'
      ? { kind: 'id', value: accessOrPollId } as const
      : accessOrPollId;
    const pollId = typeof pollIdOrGeneration === 'string' ? pollIdOrGeneration : access.value;
    const generation = typeof pollIdOrGeneration === 'number'
      ? pollIdOrGeneration
      : generationArgument ?? this.loadGeneration;
    const source =
      access.kind === 'directLink'
        ? this.api.openDirectLinkPollResultsEvents(access.value)
        : this.api.openPublicPollResultsEvents(pollId);
    source.onmessage = (event) => {
      if (!this.isLoadCurrent(generation)) {
        source.close();
        return;
      }
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
        if (delta.final) {
          this.resultsRequestRevision += 1;
          this.pendingFinalResultsPollId.set(pollId);
          this.resultsFinalizationState.set('pending');
          this.resultsFinalizationError.set(null);
          void this.reconcileFinalResults(pollId, generation);
        } else if (delta.refreshRequired) {
          this.scheduleResultsRefresh(pollId, generation);
        }
      }
    };
    source.onopen = () => {
      if (!this.isLoadCurrent(generation)) {
        source.close();
        return;
      }
      this.reconnectAttempts = 0;
      this.resultsConnectionState.set('connected');
    };
    source.onerror = () => {
      if (!this.isLoadCurrent(generation)) {
        source.close();
        return;
      }
      if (typeof EventSource !== 'undefined' && source.readyState === EventSource.CLOSED) {
        this.resultsConnectionState.set('closed');
        return;
      }
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts >= 5) {
        source.close();
        this.resultsConnectionState.set('closed');
        return;
      }
      this.resultsConnectionState.set('reconnecting');
    };
    this.resultsConnectionState.set('connecting');
    this.resultsEvents = source;
  }

  private closeResultsEvents(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.resultsEvents?.close();
    this.resultsEvents = undefined;
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => {
      if (!current || current.pollId !== delta.pollId) {
        return current;
      }

      return {
        ...current,
        answersReleased: delta.answersReleased ?? current.answersReleased,
        responseCount: delta.responseCount,
        voterCount: delta.voterCount ?? current.voterCount,
        voters: delta.voters ?? current.voters,
        aggregates: delta.aggregates ?? current.aggregates,
        responses: delta.refreshRequired ? current.responses : delta.responses,
      };
    });
  }

  private async reconcileFinalResults(pollId: string, generation: number): Promise<void> {
    const access = this.pollAccess();
    if (!access) {
      return;
    }

    await reconcilePollResults(
      () => firstValueFrom(this.getResults(access, pollId)),
      {
        isCurrent: () => this.isLoadCurrent(generation),
        apply: (results) => {
          this.results.set(results);
          this.resultsFinalizationState.set('complete');
          this.resultsFinalizationError.set(null);
          this.closeResultsEvents();
        },
        fail: () => {
          this.resultsFinalizationState.set('failed');
          this.resultsFinalizationError.set(
            'Os resultados finais ainda não estão disponíveis. Tente novamente.',
          );
        },
      },
    );
  }

  private scheduleResultsRefresh(pollId: string, generation: number): void {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (!this.isLoadCurrent(generation)) {
        return;
      }

      const requestRevision = this.resultsRequestRevision;
      const access = this.pollAccess();
      if (!access) {
        return;
      }
      void firstValueFrom(this.getResults(access, this.poll()?.id ?? pollId))
        .then((results) => {
          if (this.isLoadCurrent(generation) && requestRevision === this.resultsRequestRevision) {
            this.results.set(results);
          }
        })
        .catch(() => {
          if (this.isLoadCurrent(generation)) {
            this.error.set('A atualização dos resultados está temporariamente indisponível.');
          }
        });
    }, 250);
  }

  private isLoadCurrent(generation: number): boolean {
    return generation === this.loadGeneration;
  }

  private resultLoadErrorMessage(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
      case 401:
        return 'Sua sessão expirou. Entre novamente para consultar os resultados.';
      case 403:
        return 'Os resultados não estão disponíveis para este acesso.';
      case 404:
        return 'Votação não encontrada.';
      case 409:
        return 'A votação mudou. Atualize a página e tente novamente.';
      case 503:
        return 'O serviço de resultados está temporariamente indisponível. Tente novamente em instantes.';
      default:
        return 'Não foi possível carregar os resultados públicos desta votação. Verifique sua conexão e tente novamente.';
    }
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
      key: JSON.stringify({
        id: element.id,
        type: element.type,
        title: element.title,
        description: element.description ?? null,
        required: element.required,
        options: element.options,
        settings: element.settings ?? null,
      }),
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
