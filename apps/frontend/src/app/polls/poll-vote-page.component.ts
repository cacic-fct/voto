import { HttpErrorResponse } from '@angular/common/http';
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
import {
  MatCheckboxChange,
  MatCheckboxModule,
} from '@angular/material/checkbox';
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
  AdminCacicElectionSlate,
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionSlate,
  Poll,
  PollAnswerValue,
  PollElement,
  PollResponse,
  PollResponseAnswer,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollSchedulingAnswer,
  PollSchedulingAvailabilityWindow,
  PollSchedulingInvitee,
  PollSchedulingSettings,
  PollUserResponseState,
  PollVoterEligibilitySource,
  SubmitCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import {
  voterEligibilityDescription,
  voterEligibilityLabel,
  votingStyleVoterDescription,
  votingStyleLabel,
} from './poll-metadata';
import { PollApiService } from './poll-api.service';
import { CacicElectionSlateFormComponent } from './cacic-election-slate-form.component';
import { PollDescriptionContentComponent } from './poll-description-content.component';

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
  element: PollElement;
  answeredCount: number;
  buckets: PublicResultBucket[];
  textAnswers: string[];
};

type CacicElectionBallotOption = {
  id: string;
  label: string;
  description?: string;
  slate?: CacicElectionSlate;
};

type PollMetadataSummaryItem = {
  icon: string;
  label: string;
  value: string;
};

type PollMetadataRuleItem = {
  icon: string;
  text: string;
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
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSelectModule,
    MatSnackBarModule,
    CacicElectionSlateFormComponent,
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
  protected readonly slates = signal<CacicElectionSlate[]>([]);
  protected readonly mySlate = signal<AdminCacicElectionSlate | null>(null);
  protected readonly responseState =
    signal<PollUserResponseState>(emptyResponseState);
  protected readonly loading = signal(true);
  protected readonly loadingResults = signal(false);
  protected readonly loadingSlates = signal(false);
  protected readonly loadingResponseState = signal(false);
  protected readonly saving = signal(false);
  protected readonly savingSlate = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly resultsError = signal<string | null>(null);
  protected readonly metadataSummaryItems = computed<PollMetadataSummaryItem[]>(
    () => {
      const poll = this.poll();
      if (!poll) {
        return [];
      }

      const items: PollMetadataSummaryItem[] = [
        {
          icon: poll.votingStyle === 'anonymous' ? 'visibility_off' : 'lock',
          label: 'Nível de sigilo',
          value: votingStyleLabel(poll.votingStyle),
        },
        {
          icon: 'how_to_reg',
          label: 'Habilitação',
          value: voterEligibilityLabel(poll.voterEligibilitySource),
        },
      ];

      if (poll.linkedEvent) {
        items.push({
          icon: 'event',
          label: 'Evento',
          value: poll.linkedEvent.name,
        });
      }

      return items;
    },
  );
  protected readonly metadataRuleItems = computed<PollMetadataRuleItem[]>(
    () => {
      const poll = this.poll();
      if (!poll) {
        return [];
      }

      const items: PollMetadataRuleItem[] = [
        {
          icon:
            poll.votingStyle === 'anonymous'
              ? 'shield'
              : 'admin_panel_settings',
          text: votingStyleVoterDescription(poll.votingStyle),
        },
        {
          icon: 'verified_user',
          text: voterEligibilityDescription(poll.voterEligibilitySource),
        },
      ];

      if (poll.allowResponseEditing) {
        items.push({
          icon: 'edit',
          text: 'Você poderá editar sua resposta enquanto a votação estiver aberta.',
        });
      }

      if (poll.allowMultipleResponses) {
        items.push({
          icon: 'add_circle',
          text: 'Você poderá enviar mais de uma resposta enquanto a votação estiver aberta.',
        });
      }

      if (
        poll.mode === 'cacicElection' &&
        poll.cacicElectionPhase === 'election'
      ) {
        items.push({
          icon: 'bar_chart',
          text: 'Os resultados da eleição serão liberados somente após o encerramento.',
        });
      }

      return items;
    },
  );
  protected readonly canVote = computed(() => {
    const poll = this.poll();
    const state = this.responseState();
    if (!poll) {
      return false;
    }

    return (
      this.isPollVotingOpen(poll) &&
      !this.isSlateSubmissionPoll(poll) &&
      !this.loadingResponseState() &&
      (!state.hasSubmitted || state.canEdit || state.canSubmitAnother)
    );
  });
  protected readonly canSubmitSlate = computed(() => {
    const poll = this.poll();
    return Boolean(
      poll && this.isSlateSubmissionPoll(poll) && this.isPollVotingOpen(poll),
    );
  });
  protected readonly votingUnavailableTitle = computed(() => {
    const poll = this.poll();
    if (!poll || poll.status !== 'published') {
      return 'Votação encerrada';
    }

    const now = new Date();
    if (this.readInstantTime(poll.votingStartsAt) > now.getTime()) {
      return 'Votação ainda não aberta';
    }

    return 'Votação encerrada';
  });
  protected readonly submitButtonLabel = computed(() => {
    const state = this.responseState();
    if (state.canEdit && state.response) {
      return 'Salvar edição';
    }

    return state.hasSubmitted && state.canSubmitAnother
      ? 'Enviar nova resposta'
      : 'Enviar voto';
  });
  protected readonly publicQuestionSummaries = computed(() => {
    const poll = this.poll();
    const responses = this.results()?.responses ?? [];
    if (!poll) {
      return [];
    }

    return poll.elements
      .filter((element) => this.isAnswerElement(element))
      .map((element) => this.buildPublicQuestionSummary(element, responses));
  });
  private resultsEvents?: EventSource;

  constructor() {
    void this.loadPoll();
  }

  ngOnDestroy(): void {
    this.closeResultsEvents();
  }

  private isPollVotingOpen(poll: Poll): boolean {
    const now = new Date();
    return (
      poll.status === 'published' &&
      this.readInstantTime(poll.visibleFrom) <= now.getTime() &&
      this.readInstantTime(poll.votingStartsAt) <= now.getTime() &&
      this.readInstantTime(poll.votingEndsAt, Number.POSITIVE_INFINITY) >
        now.getTime()
    );
  }

  private readInstantTime(
    value: string | null | undefined,
    fallback = Number.NEGATIVE_INFINITY,
  ): number {
    if (!value) {
      return fallback;
    }

    const time = new Date(value).getTime();
    return Number.isNaN(time) ? fallback : time;
  }

  protected setTextAnswer(elementId: string, event: Event): void {
    const target = event.target;
    const value =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
        ? target.value
        : '';
    this.answers.update((answers) => ({ ...answers, [elementId]: value }));
  }

  protected setSingleAnswer(elementId: string, event: MatRadioChange): void {
    this.answers.update((answers) => ({
      ...answers,
      [elementId]: String(event.value),
    }));
  }

  protected setDropdownAnswer(elementId: string, event: MatSelectChange): void {
    this.answers.update((answers) => ({
      ...answers,
      [elementId]: String(event.value),
    }));
  }

  protected setNumberAnswer(elementId: string, value: number): void {
    this.answers.update((answers) => ({ ...answers, [elementId]: value }));
  }

  protected toggleMultipleAnswer(
    elementId: string,
    optionId: string,
    event: MatCheckboxChange,
  ): void {
    this.answers.update((answers) => {
      const current = Array.isArray(answers[elementId])
        ? answers[elementId]
        : [];
      const next = event.checked
        ? [...current, optionId]
        : current.filter((value) => value !== optionId);
      return { ...answers, [elementId]: next };
    });
  }

  protected setSingleGridAnswer(
    elementId: string,
    rowId: string,
    columnId: string,
  ): void {
    this.answers.update((answers) => ({
      ...answers,
      [elementId]: {
        ...this.readSingleGridAnswer(answers[elementId]),
        [rowId]: columnId,
      },
    }));
  }

  protected toggleMultipleGridAnswer(
    elementId: string,
    rowId: string,
    columnId: string,
    event: MatCheckboxChange,
  ): void {
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

  protected isSingleAnswerSelected(
    elementId: string,
    optionId: string,
  ): boolean {
    return this.answers()[elementId] === optionId;
  }

  protected isMultipleAnswerSelected(
    elementId: string,
    optionId: string,
  ): boolean {
    const value = this.answers()[elementId];
    return Array.isArray(value) && value.includes(optionId);
  }

  protected isRatingFilled(elementId: string, value: number): boolean {
    const answer = this.answers()[elementId];
    return typeof answer === 'number' && answer >= value;
  }

  protected isRatingValueSelected(elementId: string, value: number): boolean {
    return this.answers()[elementId] === value;
  }

  protected ratingOptionLabel(elementId: string, value: number): string {
    return this.isRatingValueSelected(elementId, value)
      ? `${value} estrelas selecionadas`
      : `${value} estrelas`;
  }

  protected isSingleGridColumnSelected(
    elementId: string,
    rowId: string,
    columnId: string,
  ): boolean {
    return (
      this.readSingleGridAnswer(this.answers()[elementId])[rowId] === columnId
    );
  }

  protected isMultipleGridColumnSelected(
    elementId: string,
    rowId: string,
    columnId: string,
  ): boolean {
    return (
      this.readMultipleGridAnswer(this.answers()[elementId])[rowId]?.includes(
        columnId,
      ) ?? false
    );
  }

  protected gridTemplateColumns(element: PollElement): string {
    const columnCount = Math.max(
      element.settings?.grid?.columns.length ?? 0,
      1,
    );
    return `minmax(10rem, 1.2fr) repeat(${columnCount}, minmax(7rem, 1fr))`;
  }

  protected schedulingSlots(element: PollElement): SchedulingSlotView[] {
    const settings = element.settings?.scheduling;
    if (!settings) {
      return [];
    }

    const slots: SchedulingSlotView[] = [];
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
          date: availability.date,
          startTime: this.formatTimeMinutes(startMinutes),
          endTime: this.formatTimeMinutes(endMinutes),
          windowId: availability.id,
          label: `${this.formatTimeMinutes(startMinutes)} - ${this.formatTimeMinutes(endMinutes)}`,
          meta: `${settings.durationMinutes} min`,
        });
      }
    }

    return slots;
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

  protected isSchedulingSlotSelected(
    elementId: string,
    slotId: string,
  ): boolean {
    return (
      this.readSchedulingAnswer(this.answers()[elementId]).slotId === slotId
    );
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
    return (
      this.readSchedulingAnswer(this.answers()[elementId]).invitees[index]?.[
        field
      ] ?? ''
    );
  }

  protected schedulingInviteeLabel(settings: PollSchedulingSettings): string {
    return settings.inviteeMode === 'required'
      ? 'Convidados obrigatórios'
      : 'Convidados opcionais';
  }

  protected async submit(poll: Poll): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    const wasEditing = Boolean(
      this.responseState().canEdit && this.responseState().response,
    );

    const answers: PollResponseAnswer[] = poll.elements.map((element) => ({
      elementId: element.id,
      value: this.answers()[element.id] ?? null,
    }));

    try {
      const response = await firstValueFrom(
        this.submitPollResponse(poll, { answers }),
      );
      this.applySubmittedResponseState(poll, response);
      this.snackBar.open(this.submitSuccessMessage(poll, wasEditing), 'OK', {
        duration: 3000,
      });
    } catch (error) {
      this.error.set(this.submitErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async submitSlate(
    poll: Poll,
    request: SubmitCacicElectionSlateRequest,
  ): Promise<void> {
    this.savingSlate.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.submitCacicElectionSlate(poll.id, request));
      await this.loadCacicElectionSlates(poll);
      await this.loadMyCacicElectionSlate(poll);
      this.snackBar.open('Chapa enviada para revisão.', 'OK', {
        duration: 3000,
      });
    } catch {
      this.error.set(
        'Não foi possível enviar a chapa. Confira os campos obrigatórios.',
      );
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected isSlateSubmissionPoll(poll: Poll): boolean {
    return (
      poll.mode === 'cacicElection' &&
      poll.cacicElectionPhase === 'slateSubmission'
    );
  }

  protected isCacicElectionPoll(poll: Poll): boolean {
    return poll.mode === 'cacicElection';
  }

  protected isCacicElectionVotingPoll(poll: Poll): boolean {
    return (
      poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'election'
    );
  }

  protected cacicElectionVoteElement(poll: Poll): PollElement | null {
    return (
      poll.elements.find(
        (element) => element.id === CACIC_ELECTION_VOTE_ELEMENT_ID,
      ) ?? null
    );
  }

  protected voteFormElements(poll: Poll): PollElement[] {
    return poll.elements.filter(
      (element) => element.id !== CACIC_ELECTION_VOTE_ELEMENT_ID,
    );
  }

  protected cacicElectionBallotOptions(
    poll: Poll,
  ): CacicElectionBallotOption[] {
    const voteElement = this.cacicElectionVoteElement(poll);
    if (!voteElement) {
      return [];
    }

    const slatesByOptionId = new Map(
      this.slates().map((slate) => [
        this.cacicElectionSlateOptionId(slate.id),
        slate,
      ]),
    );
    return voteElement.options.map((option) => {
      const slate = slatesByOptionId.get(option.id);
      return {
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
        ...(slate ? { slate } : {}),
      };
    });
  }

  protected setCacicElectionVote(optionId: string): void {
    this.answers.update((answers) => ({
      ...answers,
      [CACIC_ELECTION_VOTE_ELEMENT_ID]: optionId,
    }));
  }

  protected isCacicElectionVoteSelected(optionId: string): boolean {
    return this.answers()[CACIC_ELECTION_VOTE_ELEMENT_ID] === optionId;
  }

  protected memberEnrollmentYearLabel(
    member: CacicElectionSlate['members'][number],
  ): string {
    if (!member.enrollmentYear) {
      return 'Ano não informado';
    }

    const normalizedYear = member.enrollmentYear.trim();
    return /^\d{2}$/.test(normalizedYear)
      ? `20${normalizedYear}`
      : normalizedYear;
  }

  protected slateStatusLabel(status: CacicElectionSlate['status']): string {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'approved':
        return 'Aprovada';
      case 'rejected':
        return 'Rejeitada';
    }
  }

  protected slateRoleLabel(
    role: CacicElectionSlate['members'][number]['role'],
    customRole?: string,
  ): string {
    switch (role) {
      case 'president':
        return 'Presidente';
      case 'vicePresident':
        return 'Vice-Presidente';
      case 'financialDirector':
        return 'Diretor Financeiro';
      case 'communicationDirector':
        return 'Diretor de Comunicação';
      case 'eventsDirector':
        return 'Diretor de Eventos';
      case 'publicRelationsDirector':
        return 'Diretor de Relações Públicas';
      case 'other':
        return customRole || 'Outro';
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
      await this.loadCacicElectionSlates(poll);
      if (this.isSlateSubmissionPoll(poll)) {
        await this.loadMyCacicElectionSlate(poll);
      } else {
        await this.loadUserResponseState(poll);
      }
    } catch {
      this.error.set('Não foi possível carregar a votação.');
    } finally {
      this.loading.set(false);
    }
  }

  private resolvePollAccess(): PublicPollAccess | null {
    const directLinkToken = this.route.snapshot.paramMap
      .get('directLinkToken')
      ?.trim();
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

  private submitPollResponse(
    poll: Poll,
    request: { answers: PollResponseAnswer[] },
  ) {
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
      return this.voterEligibilityDeniedMessage(
        this.poll()?.voterEligibilitySource,
      );
    }

    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'Sua resposta já foi registrada nesta votação.';
    }

    return 'Não foi possível registrar sua resposta. Confira os campos obrigatórios.';
  }

  private async loadUserResponseState(poll: Poll): Promise<void> {
    if (this.isSlateSubmissionPoll(poll)) {
      this.responseState.set(emptyResponseState);
      return;
    }

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

  private applySubmittedResponseState(
    poll: Poll,
    response: PollResponse,
  ): void {
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

    return poll.allowMultipleResponses
      ? 'Resposta registrada. Você pode enviar outra resposta.'
      : 'Voto registrado.';
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
      this.resultsError.set(
        'Não foi possível carregar os resultados públicos.',
      );
    } finally {
      this.loadingResults.set(false);
    }
  }

  private async loadCacicElectionSlates(poll: Poll): Promise<void> {
    if (
      !this.isCacicElectionVotingPoll(poll) ||
      this.pollAccess?.kind === 'directLink'
    ) {
      this.slates.set([]);
      return;
    }

    this.loadingSlates.set(true);
    try {
      this.slates.set(
        await firstValueFrom(this.api.listPublicCacicElectionSlates(poll.id)),
      );
    } catch {
      this.slates.set([]);
    } finally {
      this.loadingSlates.set(false);
    }
  }

  private async loadMyCacicElectionSlate(poll: Poll): Promise<void> {
    if (!this.isSlateSubmissionPoll(poll)) {
      this.mySlate.set(null);
      return;
    }

    this.loadingSlates.set(true);
    try {
      this.mySlate.set(
        await firstValueFrom(this.api.getMyCacicElectionSlate(poll.id)),
      );
    } catch {
      this.mySlate.set(null);
    } finally {
      this.loadingSlates.set(false);
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

      const existingResponses = new Map(
        current.responses.map((response) => [response.id, response]),
      );
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

  protected shouldShowPublicResults(poll: Poll): boolean {
    if (
      poll.mode === 'cacicElection' &&
      poll.cacicElectionPhase === 'election'
    ) {
      return poll.resultsPublic && poll.status === 'closed';
    }

    return poll.resultsPublic && (poll.resultsLive || poll.status === 'closed');
  }

  protected resultsLink(poll: Poll): unknown[] {
    return this.pollAccess?.kind === 'directLink'
      ? ['/polls/direct', this.pollAccess.value, 'results']
      : ['/polls', poll.id, 'results'];
  }

  private buildPublicQuestionSummary(
    element: PollElement,
    responses: PollResultsResponse[],
  ): PublicQuestionResultSummary {
    const values = responses
      .map((response) => this.findAnswerValue(response, element.id))
      .filter((value) => !this.isEmptyAnswerValue(value));

    return {
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

  private buildPublicTextAnswers(
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

  protected resultBucketPercent(
    summary: PublicQuestionResultSummary,
    bucket: PublicResultBucket,
  ): number {
    return summary.answeredCount > 0
      ? Math.round((bucket.count / summary.answeredCount) * 100)
      : 0;
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

  private cacicElectionSlateOptionId(slateId: string): string {
    return `slate:${slateId}`;
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

  private voterEligibilityDeniedMessage(
    source: PollVoterEligibilitySource | undefined,
  ): string {
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

  private readSingleGridAnswer(
    value: AnswerValue | undefined,
  ): Record<string, string> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce<Record<string, string>>(
      (answer, [rowId, columnId]) => {
        if (typeof columnId === 'string') {
          answer[rowId] = columnId;
        }

        return answer;
      },
      {},
    );
  }

  private readMultipleGridAnswer(
    value: AnswerValue | undefined,
  ): Record<string, string[]> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.entries(value).reduce<Record<string, string[]>>(
      (answer, [rowId, columnIds]) => {
        if (Array.isArray(columnIds)) {
          answer[rowId] = columnIds.filter(
            (columnId): columnId is string => typeof columnId === 'string',
          );
        }

        return answer;
      },
      {},
    );
  }

  private readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
    const recordValue = this.asRecord(value);
    if (!recordValue) {
      return {
        slotId: '',
        invitees: [],
      };
    }

    const invitees = Array.isArray(recordValue['invitees'])
      ? recordValue['invitees']
          .map((invitee) => this.asRecord(invitee))
          .filter(
            (invitee): invitee is Record<string, unknown> => invitee !== null,
          )
      : [];

    return {
      slotId:
        typeof recordValue['slotId'] === 'string' ? recordValue['slotId'] : '',
      invitees: invitees.map((invitee) => ({
        name: typeof invitee['name'] === 'string' ? invitee['name'] : '',
        email: typeof invitee['email'] === 'string' ? invitee['email'] : '',
      })),
    };
  }

  private schedulingSlotId(
    availability: PollSchedulingAvailabilityWindow,
    startMinutes: number,
  ): string {
    return `${availability.id}:${this.formatTimeMinutes(startMinutes)}`;
  }

  private formatDateLabel(value: string): string {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) {
      return value;
    }

    const weekday = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
    return `${weekday.replace('.', '')}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
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
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
