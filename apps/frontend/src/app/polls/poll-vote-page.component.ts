import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioChange, MatRadioModule } from '@angular/material/radio';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Poll,
  PollAnswerValue,
  PollElement,
  PollResponse,
  PollResponseAnswer,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollSchedulingAnswer,
  PollSchedulingInvitee,
  PollSchedulingSettings,
  PollUserResponseState,
  PollVoterEligibilitySource,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import {
  voterEligibilityDescription,
  voterEligibilityLabel,
  votingStyleVoterDescription,
  votingStyleLabel,
} from './poll-metadata';
import { PollApiService } from './poll-api.service';
import { PollDescriptionContentComponent } from './poll-description-content.component';
import {
  answerValueLabels,
  collectAnswerEntriesForElementVersion,
  collectResultElementVersions,
  formatDateLabel,
  isEmptyAnswerValue,
  schedulingSlots as buildSchedulingSlots,
} from './poll-result-formatting';

type AnswerValue = Exclude<PollAnswerValue, null>;

type SchedulingSlotView = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  windowId: string;
  label: string;
  meta: string;
};

type SchedulingSlotGroup = {
  date: string;
  label: string;
  slots: SchedulingSlotView[];
};

type PublicResultBucket = {
  label: string;
  count: number;
};

type PublicQuestionResultSummary = {
  key: string;
  element: PollElement;
  answeredCount: number;
  buckets: PublicResultBucket[];
  textAnswers: string[];
};

type PublicPollAccess =
  | {
      kind: 'id';
      value: string;
    }
  | {
      kind: 'directLink';
      value: string;
    };

const emptyResponseState: PollUserResponseState = {
  hasSubmitted: false,
  canEdit: false,
  canSubmitAnother: false,
};

@Component({
  selector: 'app-poll-vote-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSelectModule,
    MatSnackBarModule,
    PollDescriptionContentComponent,
  ],
  templateUrl: './poll-vote-page.component.html',
  styleUrl: './poll-vote-page.component.scss',
})
export class PollVotePageComponent implements OnDestroy {
  private readonly api = inject(PollApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly pollAccess = this.resolvePollAccess();

  protected readonly poll = signal<Poll | null>(null);
  protected readonly answers = signal<Record<string, AnswerValue>>({});
  protected readonly results = signal<PollResults | null>(null);
  protected readonly responseState = signal<PollUserResponseState>(emptyResponseState);
  protected readonly loading = signal(true);
  protected readonly loadingResults = signal(false);
  protected readonly loadingResponseState = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly resultsError = signal<string | null>(null);
  protected readonly votingStyleLabel = votingStyleLabel;
  protected readonly votingStyleVoterDescription = votingStyleVoterDescription;
  protected readonly voterEligibilityLabel = voterEligibilityLabel;
  protected readonly voterEligibilityDescription = voterEligibilityDescription;
  protected readonly canVote = computed(() => {
    const poll = this.poll();
    const state = this.responseState();
    return (
      poll?.status === 'published' &&
      !this.loadingResponseState() &&
      (!state.hasSubmitted || state.canEdit || state.canSubmitAnother)
    );
  });
  protected readonly submitButtonLabel = computed(() => {
    const state = this.responseState();
    if (state.canEdit && state.response) {
      return 'Salvar edição';
    }

    return state.hasSubmitted && state.canSubmitAnother ? 'Enviar nova resposta' : 'Enviar voto';
  });
  protected readonly publicQuestionSummaries = computed(() => {
    const poll = this.poll();
    const responses = this.results()?.responses ?? [];
    if (!poll) {
      return [];
    }

    return collectResultElementVersions(poll.elements, responses).map((version) =>
      this.buildPublicQuestionSummary(version, poll.elements, responses),
    );
  });
  private resultsEvents?: EventSource;

  constructor() {
    void this.loadPoll();
  }

  ngOnDestroy(): void {
    this.closeResultsEvents();
  }

  protected setTextAnswer(elementId: string, event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
    this.answers.update((answers) => ({ ...answers, [elementId]: value }));
  }

  protected setSingleAnswer(elementId: string, event: MatRadioChange): void {
    this.answers.update((answers) => ({ ...answers, [elementId]: String(event.value) }));
  }

  protected setDropdownAnswer(elementId: string, event: MatSelectChange): void {
    this.answers.update((answers) => ({ ...answers, [elementId]: String(event.value) }));
  }

  protected setNumberAnswer(elementId: string, value: number): void {
    this.answers.update((answers) => ({ ...answers, [elementId]: value }));
  }

  protected toggleMultipleAnswer(elementId: string, optionId: string, event: MatCheckboxChange): void {
    this.answers.update((answers) => {
      const current = Array.isArray(answers[elementId]) ? answers[elementId] : [];
      const next = event.checked ? [...current, optionId] : current.filter((value) => value !== optionId);
      return { ...answers, [elementId]: next };
    });
  }

  protected setSingleGridAnswer(elementId: string, rowId: string, columnId: string): void {
    this.answers.update((answers) => ({
      ...answers,
      [elementId]: {
        ...this.readSingleGridAnswer(answers[elementId]),
        [rowId]: columnId,
      },
    }));
  }

  protected toggleMultipleGridAnswer(elementId: string, rowId: string, columnId: string, event: MatCheckboxChange): void {
    this.answers.update((answers) => {
      const current = this.readMultipleGridAnswer(answers[elementId]);
      const rowValues = current[rowId] ?? [];
      const nextRowValues = event.checked
        ? [...rowValues, columnId]
        : rowValues.filter((value) => value !== columnId);

      return {
        ...answers,
        [elementId]: {
          ...current,
          [rowId]: nextRowValues,
        },
      };
    });
  }

  protected linearScaleValues(element: PollElement): number[] {
    const min = element.settings?.linearScale?.min ?? 1;
    const max = element.settings?.linearScale?.max ?? 5;
    return this.range(min, max);
  }

  protected starRatingValues(element: PollElement): number[] {
    return this.range(1, element.settings?.starRating?.max ?? 5);
  }

  protected isNumberAnswerSelected(elementId: string, value: number): boolean {
    return this.answers()[elementId] === value;
  }

  protected textAnswerValue(elementId: string): string {
    const value = this.answers()[elementId];
    return typeof value === 'string' ? value : '';
  }

  protected singleAnswerValue(elementId: string): string {
    const value = this.answers()[elementId];
    return typeof value === 'string' ? value : '';
  }

  protected isSingleAnswerSelected(elementId: string, optionId: string): boolean {
    return this.answers()[elementId] === optionId;
  }

  protected isMultipleAnswerSelected(elementId: string, optionId: string): boolean {
    const value = this.answers()[elementId];
    return Array.isArray(value) && value.includes(optionId);
  }

  protected isRatingFilled(elementId: string, value: number): boolean {
    const answer = this.answers()[elementId];
    return typeof answer === 'number' && answer >= value;
  }

  protected isSingleGridColumnSelected(elementId: string, rowId: string, columnId: string): boolean {
    return this.readSingleGridAnswer(this.answers()[elementId])[rowId] === columnId;
  }

  protected isMultipleGridColumnSelected(elementId: string, rowId: string, columnId: string): boolean {
    return this.readMultipleGridAnswer(this.answers()[elementId])[rowId]?.includes(columnId) ?? false;
  }

  protected gridTemplateColumns(element: PollElement): string {
    const columnCount = Math.max(element.settings?.grid?.columns.length ?? 0, 1);
    return `minmax(10rem, 1.2fr) repeat(${columnCount}, minmax(7rem, 1fr))`;
  }

  protected schedulingSlots(element: PollElement): SchedulingSlotView[] {
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

  protected schedulingSlotGroups(element: PollElement): SchedulingSlotGroup[] {
    const groups = new Map<string, SchedulingSlotView[]>();
    for (const slot of this.schedulingSlots(element)) {
      groups.set(slot.date, [...(groups.get(slot.date) ?? []), slot]);
    }

    return [...groups.entries()].map(([date, slots]) => ({
      date,
      label: this.formatDateLabel(date),
      slots,
    }));
  }

  protected setSchedulingSlot(elementId: string, slotId: string): void {
    this.answers.update((answers) => {
      const current = this.readSchedulingAnswer(answers[elementId]);
      return {
        ...answers,
        [elementId]: {
          ...current,
          slotId,
        },
      };
    });
  }

  protected setSchedulingInvitee(
    elementId: string,
    index: number,
    field: keyof PollSchedulingInvitee,
    event: Event,
  ): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? target.value : '';
    this.answers.update((answers) => {
      const current = this.readSchedulingAnswer(answers[elementId]);
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
    });
  }

  protected isSchedulingSlotSelected(elementId: string, slotId: string): boolean {
    return this.readSchedulingAnswer(this.answers()[elementId]).slotId === slotId;
  }

  protected schedulingInviteeIndexes(element: PollElement): number[] {
    const settings = element.settings?.scheduling;
    if (!settings || settings.inviteeMode === 'none') {
      return [];
    }

    return this.range(0, Math.max(0, settings.maxInvitees - 1));
  }

  protected schedulingInviteeValue(
    elementId: string,
    index: number,
    field: keyof PollSchedulingInvitee,
  ): string {
    return this.readSchedulingAnswer(this.answers()[elementId]).invitees[index]?.[field] ?? '';
  }

  protected schedulingInviteeLabel(settings: PollSchedulingSettings): string {
    return settings.inviteeMode === 'required' ? 'Convidados obrigatórios' : 'Convidados opcionais';
  }

  protected async submit(poll: Poll): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    const wasEditing = Boolean(this.responseState().canEdit && this.responseState().response);

    const answers: PollResponseAnswer[] = poll.elements.map((element) => ({
      elementId: element.id,
      value: this.answers()[element.id] ?? null,
    }));

    try {
      const response = await firstValueFrom(this.submitPollResponse(poll, { answers }));
      this.applySubmittedResponseState(poll, response);
      if (this.shouldShowPublicResults(poll) && !this.results()) {
        await this.loadPublicResults(poll);
      }
      this.snackBar.open(this.submitSuccessMessage(poll, wasEditing), 'OK', { duration: 3000 });
    } catch (error) {
      this.error.set(this.submitErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private async loadPoll(): Promise<void> {
    if (!this.pollAccess) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }

    try {
      const poll = await firstValueFrom(this.getPoll(this.pollAccess));
      this.poll.set(poll);
      await this.loadUserResponseState(poll);
      await this.loadPublicResults(poll);
    } catch {
      this.error.set('Não foi possível carregar a votação.');
    } finally {
      this.loading.set(false);
    }
  }

  private resolvePollAccess(): PublicPollAccess | null {
    const directLinkToken = this.route.snapshot.paramMap.get('directLinkToken')?.trim();
    if (directLinkToken) {
      return {
        kind: 'directLink',
        value: directLinkToken,
      };
    }

    const id = this.route.snapshot.paramMap.get('id')?.trim();
    return id
      ? {
          kind: 'id',
          value: id,
        }
      : null;
  }

  private getPoll(access: PublicPollAccess) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPoll(access.value)
      : this.api.getPublicPoll(access.value);
  }

  private submitPollResponse(poll: Poll, request: { answers: PollResponseAnswer[] }) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.submitDirectLinkResponse(this.pollAccess.value, request)
      : this.api.submitResponse(poll.id, request);
  }

  private getMyPollResponse(pollId: string) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.getMyDirectLinkPollResponse(this.pollAccess.value)
      : this.api.getMyPollResponse(pollId);
  }

  private getPublicPollResults(pollId: string) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.getDirectLinkPollResults(this.pollAccess.value)
      : this.api.getPublicPollResults(pollId);
  }

  private submitErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Entre para votar nesta votação.';
    }

    if (error instanceof HttpErrorResponse && error.status === 403) {
      return this.voterEligibilityDeniedMessage(this.poll()?.voterEligibilitySource);
    }

    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'Sua resposta já foi registrada nesta votação.';
    }

    return 'Não foi possível registrar sua resposta. Confira os campos obrigatórios.';
  }

  private async loadUserResponseState(poll: Poll): Promise<void> {
    this.loadingResponseState.set(true);
    this.responseState.set(emptyResponseState);
    try {
      const state = await firstValueFrom(this.getMyPollResponse(poll.id));
      this.responseState.set(state);
      if (state.canEdit && state.response && !state.canSubmitAnother) {
        this.applyResponseAnswers(state.response.answers);
      }
    } catch {
      this.responseState.set(emptyResponseState);
    } finally {
      this.loadingResponseState.set(false);
    }
  }

  private applySubmittedResponseState(poll: Poll, response: PollResponse): void {
    if (poll.allowMultipleResponses) {
      this.responseState.set({
        hasSubmitted: true,
        canEdit: false,
        canSubmitAnother: true,
      });
      this.answers.set({});
      return;
    }

    if (poll.allowResponseEditing && poll.votingStyle !== 'anonymous') {
      this.responseState.set({
        hasSubmitted: true,
        canEdit: true,
        canSubmitAnother: false,
        response,
      });
      this.applyResponseAnswers(response.answers);
      return;
    }

    this.responseState.set({
      hasSubmitted: true,
      canEdit: false,
      canSubmitAnother: false,
    });
  }

  private applyResponseAnswers(answers: PollResponseAnswer[]): void {
    this.answers.set(
      answers.reduce<Record<string, AnswerValue>>((currentAnswers, answer) => {
        if (answer.value !== null) {
          currentAnswers[answer.elementId] = answer.value;
        }

        return currentAnswers;
      }, {}),
    );
  }

  private submitSuccessMessage(poll: Poll, wasEditing: boolean): string {
    if (wasEditing) {
      return 'Resposta atualizada.';
    }

    return poll.allowMultipleResponses ? 'Resposta registrada. Você pode enviar outra resposta.' : 'Voto registrado.';
  }

  private async loadPublicResults(poll: Poll): Promise<void> {
    this.closeResultsEvents();
    this.results.set(null);
    this.resultsError.set(null);

    if (!this.shouldShowPublicResults(poll)) {
      return;
    }

    this.loadingResults.set(true);
    try {
      const results = await firstValueFrom(this.getPublicPollResults(poll.id));
      this.results.set(results);
      if (poll.status === 'published' && poll.resultsLive) {
        this.openPublicResultsEvents(poll.id);
      }
    } catch {
      this.resultsError.set('Não foi possível carregar os resultados públicos.');
    } finally {
      this.loadingResults.set(false);
    }
  }

  private openPublicResultsEvents(pollId: string): void {
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

      const existingResponses = new Map(current.responses.map((response) => [response.id, response]));
      for (const response of delta.responses) {
        existingResponses.set(response.id, response);
      }

      return {
        ...current,
        responseCount: delta.responseCount,
        responses: [...existingResponses.values()],
      };
    });
  }

  private shouldShowPublicResults(poll: Poll): boolean {
    return poll.resultsPublic && (poll.resultsLive || poll.status === 'closed');
  }

  private buildPublicQuestionSummary(
    version: { key: string; element: PollElement },
    currentElements: readonly PollElement[],
    responses: PollResultsResponse[],
  ): PublicQuestionResultSummary {
    const element = version.element;
    const values = collectAnswerEntriesForElementVersion(version.key, currentElements, responses)
      .map((entry) => entry.value)
      .filter((value) => !this.isEmptyAnswerValue(value));

    return {
      key: version.key,
      element,
      answeredCount: values.length,
      buckets: this.buildPublicResultBuckets(element, values),
      textAnswers: this.buildPublicTextAnswers(element, values),
    };
  }

  private buildPublicResultBuckets(
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

  private buildPublicTextAnswers(element: PollElement, values: (PollAnswerValue | undefined)[]): string[] {
    if (element.type !== 'shortText' && element.type !== 'longText') {
      return [];
    }

    return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  private answerValueLabels(element: PollElement, value: PollAnswerValue | undefined): string[] {
    return answerValueLabels(element, value);
  }

  protected resultBucketPercent(summary: PublicQuestionResultSummary, bucket: PublicResultBucket): number {
    return summary.answeredCount > 0 ? Math.round((bucket.count / summary.answeredCount) * 100) : 0;
  }

  private isEmptyAnswerValue(value: PollAnswerValue | undefined): boolean {
    return isEmptyAnswerValue(value);
  }

  private voterEligibilityDeniedMessage(source: PollVoterEligibilitySource | undefined): string {
    switch (source) {
      case 'eventAttendance':
        return 'Esta votação está disponível apenas para pessoas com presença registrada no evento vinculado.';
      case 'eventAttendanceUnespUsers':
        return 'Esta votação está disponível apenas para unespianos com presença registrada no evento vinculado.';
      case 'eventAttendanceComputerScienceStudents':
        return 'Esta votação está disponível apenas para alunos da computação com presença registrada no evento vinculado.';
      case 'unespUsers':
        return 'Esta votação está disponível apenas para unespianos.';
      case 'computerScienceStudents':
        return 'Esta votação está disponível apenas para alunos da computação.';
      case 'enrollmentList':
        return 'Esta votação está disponível apenas para matrículas cadastradas na lista de habilitados.';
      case 'authenticatedUsers':
      case undefined:
        return 'Você não está habilitado a votar nesta votação.';
    }
  }

  private range(min: number, max: number): number[] {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  private readSingleGridAnswer(value: AnswerValue | undefined): Record<string, string> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce<Record<string, string>>((answer, [rowId, columnId]) => {
      if (typeof columnId === 'string') {
        answer[rowId] = columnId;
      }

      return answer;
    }, {});
  }

  private readMultipleGridAnswer(value: AnswerValue | undefined): Record<string, string[]> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce<Record<string, string[]>>((answer, [rowId, columnIds]) => {
      if (Array.isArray(columnIds)) {
        answer[rowId] = columnIds.filter((columnId): columnId is string => typeof columnId === 'string');
      }

      return answer;
    }, {});
  }

  private readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
    const recordValue = this.isRecord(value) ? value : null;
    if (!recordValue) {
      return {
        slotId: '',
        invitees: [],
      };
    }

    const invitees = Array.isArray(recordValue['invitees'])
      ? recordValue['invitees']
          .map((invitee) => this.isRecord(invitee) ? invitee : null)
          .filter((invitee): invitee is Record<string, unknown> => invitee !== null)
      : [];

    return {
      slotId: typeof recordValue['slotId'] === 'string' ? recordValue['slotId'] : '',
      invitees: invitees.map((invitee) => ({
        name: typeof invitee['name'] === 'string' ? invitee['name'] : '',
        email: typeof invitee['email'] === 'string' ? invitee['email'] : '',
      })),
    };
  }

  private formatDateLabel(value: string): string {
    return formatDateLabel(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
