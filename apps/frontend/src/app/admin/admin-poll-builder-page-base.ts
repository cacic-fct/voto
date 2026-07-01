import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectChange } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  AdminCacicElectionSlate,
  EventManagerEvent,
  PollEligibilityEnrollment,
  PollResults,
  PollSummary,
} from '@org/voting-contracts';
import {
  buildAnswerSummaryCharts,
  buildDemographicsCharts,
  buildQuestionSummaries,
  buildTextQuestionSummaries,
  selectedIndividualAnswers,
  toVoterRows,
} from './admin-poll-results';
import { firstValueFrom } from 'rxjs';
import { PollApiService } from '../polls/poll-api.service';
import { isAnswerElement } from '../polls/poll-result-formatting';
import {
  VOTER_ELIGIBILITY_METADATA,
  VOTING_STYLE_METADATA,
  supportsVerifiedUnespRoleRequirement,
} from '../polls/poll-metadata';
import { PollBuilderDraftService } from './poll-builder-draft.service';

export abstract class AdminPollBuilderPageBase {
  protected readonly api = inject(PollApiService);
  protected readonly dialog = inject(MatDialog);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly snackBar = inject(MatSnackBar);
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  protected resultsEvents?: EventSource;
  protected readonly builder = inject(PollBuilderDraftService);
  protected readonly polls = signal<PollSummary[]>([]);
  protected readonly linkableEvents = signal<EventManagerEvent[]>([]);
  protected readonly eligibilityEntries = signal<PollEligibilityEnrollment[]>([]);
  protected readonly selectedVotingStyle = computed(() => VOTING_STYLE_METADATA[this.builder.draft().votingStyle]);
  protected readonly selectedVoterEligibility = computed(
    () => VOTER_ELIGIBILITY_METADATA[this.builder.draft().voterEligibilitySource],
  );
  protected readonly shouldShowEnrollmentListControls = computed(
    () => this.builder.draft().voterEligibilitySource === 'enrollmentList',
  );
  protected readonly shouldShowVerifiedUnespRoleRequirement = computed(() =>
    supportsVerifiedUnespRoleRequirement(this.builder.draft().voterEligibilitySource),
  );
  protected readonly eventOptions = computed(() => {
    const linkedEvent = this.builder.draft().linkedEvent;
    const events = this.linkableEvents();
    if (!linkedEvent || events.some((event) => event.id === linkedEvent.id)) {
      return events;
    }

    return [
      {
        ...linkedEvent,
        shouldCollectAttendance: false,
      },
      ...events,
    ];
  });
  protected readonly loadingList = signal(true);
  protected readonly loadingEvents = signal(true);
  protected readonly loadingEligibility = signal(false);
  protected readonly saving = signal(false);
  protected readonly importingEligibility = signal(false);
  protected readonly slates = signal<AdminCacicElectionSlate[]>([]);
  protected readonly loadingSlates = signal(false);
  protected readonly savingSlate = signal(false);
  protected readonly editingSlate = signal<AdminCacicElectionSlate | null>(null);
  protected readonly uploadingImageTarget = signal<string | null>(null);
  protected readonly imageAccept =
    'image/avif,image/bmp,image/gif,image/heic,image/heif,image/jpeg,image/png,image/tiff,image/webp';
  protected readonly manualEnrollmentNumbers = signal('');
  protected readonly results = signal<PollResults | null>(null);
  protected readonly loadingResults = signal(false);
  protected readonly exportingCacicElectionVoters = signal(false);
  protected readonly selectedResultsElementId = signal<string | null>(null);
  protected readonly selectedIndividualResponseId = signal<string | null>(null);
  protected readonly answerElements = computed(() =>
    this.builder.draft().elements.filter((element) => isAnswerElement(element)),
  );
  protected readonly questionSummaries = computed(() =>
    buildQuestionSummaries(this.builder.draft().elements, this.results()?.responses ?? []),
  );
  protected readonly selectedQuestionSummary = computed(() => {
    const summaries = this.questionSummaries();
    const selectedId = this.selectedResultsElementId();
    return summaries.find((summary) => summary.key === selectedId) ?? summaries[0] ?? null;
  });
  protected readonly selectedQuestionElementId = computed(() => this.selectedQuestionSummary()?.key ?? null);
  protected readonly voterRows = computed(() =>
    toVoterRows(this.results()?.responses ?? []),
  );
  protected readonly demographicsCharts = computed(() =>
    buildDemographicsCharts(this.voterRows(), this.individualResultsAvailable()),
  );
  protected readonly answerSummaryCharts = computed(() =>
    buildAnswerSummaryCharts(this.questionSummaries()),
  );
  protected readonly textQuestionSummaries = computed(() =>
    buildTextQuestionSummaries(this.questionSummaries()),
  );
  protected readonly individualResultsAvailable = computed(() =>
    (this.results()?.responses ?? []).some((response) => Boolean(response.voter)),
  );
  protected readonly selectedIndividualResponse = computed(() => {
    const responses = this.results()?.responses ?? [];
    const selectedId = this.selectedIndividualResponseId();
    return responses.find((response) => response.id === selectedId) ?? responses.find((response) => response.voter) ?? null;
  });
  protected readonly selectedIndividualAnswers = computed(() => {
    const response = this.selectedIndividualResponse();
    if (!response) {
      return [];
    }

    return selectedIndividualAnswers(response, this.answerElements());
  });
  protected readonly directLinkUrl = computed(() => {
    const draft = this.builder.draft();
    if (!draft.directLinkEnabled || !draft.directLinkToken) {
      return '';
    }

    const path = `/polls/direct/${encodeURIComponent(draft.directLinkToken)}`;
    return this.isBrowser ? new URL(path, globalThis.location.origin).toString() : path;
  });
  protected readonly pollLinkUrl = computed(() => {
    const draft = this.builder.draft();
    if (!draft.id) {
      return '';
    }

    const path = `/polls/${encodeURIComponent(draft.id)}`;
    return this.isBrowser ? new URL(path, globalThis.location.origin).toString() : path;
  });
  protected readonly canExportCacicElectionVoters = computed(() => {
    const draft = this.builder.draft();
    return Boolean(
      draft.id && draft.mode === 'cacicElection' && draft.cacicElectionPhase === 'election' && draft.status === 'closed',
    );
  });

  protected abstract loadEligibilityEnrollments(showLoading?: boolean): Promise<void>;
  protected abstract resetResults(): void;

  protected newPoll(): void {
    this.builder.newPoll();
    this.eligibilityEntries.set([]);
    this.slates.set([]);
    this.editingSlate.set(null);
    this.manualEnrollmentNumbers.set('');
    this.resetResults();
  }

  protected updateLinkedEvent(event: MatSelectChange): void {
    this.builder.updateLinkedEvent(event, this.eventOptions());
  }

  protected updateVoterEligibilitySource(event: MatSelectChange): void {
    this.builder.updateVoterEligibilitySource(event);
    void this.loadEligibilityEnrollments(false);
  }

  protected updateManualEnrollmentNumbers(event: Event): void {
    this.manualEnrollmentNumbers.set((event.target as HTMLTextAreaElement).value);
  }

  protected async copyDirectLink(): Promise<void> {
    const url = this.directLinkUrl();
    if (!url || !this.isBrowser || !globalThis.navigator?.clipboard) {
      this.snackBar.open('Link direto ainda não disponível.', 'OK', { duration: 3000 });
      return;
    }

    try {
      await globalThis.navigator.clipboard.writeText(url);
      this.snackBar.open('Link direto copiado.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível copiar o link direto.', 'OK', { duration: 3000 });
    }
  }

  protected async copyPollLink(): Promise<void> {
    const url = this.pollLinkUrl();
    if (!url || !this.isBrowser || !globalThis.navigator?.clipboard) {
      this.snackBar.open('Salve a votação para copiar o link.', 'OK', { duration: 3000 });
      return;
    }

    try {
      await globalThis.navigator.clipboard.writeText(url);
      this.snackBar.open('Link da votação copiado.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível copiar o link da votação.', 'OK', { duration: 3000 });
    }
  }

  protected isUploadingImage(target: string): boolean {
    return this.uploadingImageTarget() === target;
  }

  protected eventDateLabel(event: EventManagerEvent): string {
    return `${this.dateTimeFormatter.format(new Date(event.startDate))} - ${this.dateTimeFormatter.format(new Date(event.endDate))}`;
  }

  protected async loadPolls(showLoading = true): Promise<void> {
    if (showLoading) {
      this.loadingList.set(true);
    }

    try {
      this.polls.set(await firstValueFrom(this.api.listAdminPolls()));
    } catch {
      this.snackBar.open('Não foi possível carregar a lista de votações.', 'OK', { duration: 3000 });
    } finally {
      this.loadingList.set(false);
    }
  }

  protected async loadLinkableEvents(): Promise<void> {
    this.loadingEvents.set(true);

    try {
      this.linkableEvents.set(await firstValueFrom(this.api.listLinkableEvents()));
    } catch {
      this.snackBar.open('Não foi possível carregar os eventos disponíveis.', 'OK', { duration: 3000 });
    } finally {
      this.loadingEvents.set(false);
    }
  }

}
