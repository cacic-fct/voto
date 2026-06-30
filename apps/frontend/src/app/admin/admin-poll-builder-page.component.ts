import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  EventManagerEvent,
  PollEligibilityEnrollment,
  PollEligibilityMutationMode,
  PollImage,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollStatus,
  PollSummary,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { PollApiService } from '../polls/poll-api.service';
import { PollDescriptionContentComponent } from '../polls/poll-description-content.component';
import {
  VOTER_ELIGIBILITY_METADATA,
  VOTING_STYLE_METADATA,
  supportsVerifiedUnespRoleRequirement,
} from '../polls/poll-metadata';
import { parseCsv } from './csv-parser';
import { EligibilityCsvColumnDialogComponent } from './eligibility-csv-column-dialog.component';
import { AdminPollElementsEditorComponent } from './admin-poll-elements-editor.component';
import { AdminPollResultsPanelComponent } from './admin-poll-results-panel.component';
import { PollBuilderDraftService } from './poll-builder-draft.service';
import {
  isAnswerElement,
} from '../polls/poll-result-formatting';
import {
  buildAnswerSummaryCharts,
  buildDemographicsCharts,
  buildQuestionSummaries,
  buildTextQuestionSummaries,
  responseVoterLabel,
  selectedIndividualAnswers,
  toVoterRows,
} from './admin-poll-results';

@Component({
  selector: 'app-admin-poll-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    AdminPollElementsEditorComponent,
    AdminPollResultsPanelComponent,
    PollDescriptionContentComponent,
  ],
  providers: [PollBuilderDraftService],
  templateUrl: './admin-poll-builder-page.component.html',
  styleUrl: './admin-poll-builder-page.component.scss',
})
export class AdminPollBuilderPageComponent implements OnDestroy {
  private readonly api = inject(PollApiService);
  private readonly dialog = inject(MatDialog);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly snackBar = inject(MatSnackBar);
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  private resultsEvents?: EventSource;

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
  protected readonly uploadingImageTarget = signal<string | null>(null);
  protected readonly imageAccept =
    'image/avif,image/bmp,image/gif,image/heic,image/heif,image/jpeg,image/png,image/tiff,image/webp';
  protected readonly manualEnrollmentNumbers = signal('');
  protected readonly results = signal<PollResults | null>(null);
  protected readonly loadingResults = signal(false);
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

  constructor() {
    void this.loadPolls();
    void this.loadLinkableEvents();
  }

  ngOnDestroy(): void {
    this.closeResultsEvents();
  }

  protected newPoll(): void {
    this.builder.newPoll();
    this.eligibilityEntries.set([]);
    this.manualEnrollmentNumbers.set('');
    this.resetResults();
  }

  protected async selectPoll(id: string): Promise<void> {
    this.saving.set(true);
    this.resetResults();
    try {
      this.builder.setDraft(await firstValueFrom(this.api.getAdminPoll(id)));
      await this.loadEligibilityEnrollments(false);
      await this.loadResults(false);
    } catch {
      this.snackBar.open('Não foi possível abrir a votação.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (!this.builder.canSave()) {
      this.snackBar.open('Informe o título da votação.', 'OK', { duration: 3000 });
      return;
    }

    this.saving.set(true);
    try {
      const draft = this.builder.draft();
      const request = this.builder.toSaveRequest(draft);
      const saved = draft.id
        ? await firstValueFrom(this.api.updatePoll(draft.id, request))
        : await firstValueFrom(this.api.createPoll(request));
      this.builder.setDraft(saved);
      await this.loadEligibilityEnrollments(false);
      await this.loadResults(false);
      await this.loadPolls(false);
      this.snackBar.open('Votação salva.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível salvar. Confira os itens e opções.', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async setStatus(status: PollStatus): Promise<void> {
    const id = this.builder.draft().id;
    if (!id) {
      return;
    }

    this.saving.set(true);
    try {
      this.builder.setDraft(await firstValueFrom(this.api.updatePollStatus(id, status)));
      await this.loadPolls(false);
      this.snackBar.open('Status atualizado.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível atualizar o status.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async deletePoll(): Promise<void> {
    const id = this.builder.draft().id;
    if (!id || !globalThis.confirm('Excluir esta votação e todas as respostas?')) {
      return;
    }

    this.saving.set(true);
    try {
      await firstValueFrom(this.api.deletePoll(id));
      this.builder.newPoll();
      this.resetResults();
      await this.loadPolls(false);
      this.snackBar.open('Votação excluída.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível excluir a votação.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
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

  protected isUploadingImage(target: string): boolean {
    return this.uploadingImageTarget() === target;
  }

  protected async uploadPollDescriptionImage(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    const pollId = await this.ensurePollSavedForImages();
    if (!pollId) {
      return;
    }

    this.uploadingImageTarget.set('poll');
    try {
      const image = await firstValueFrom(this.api.uploadPollImage(pollId, file));
      this.builder.addPollDescriptionImage(image);
      await this.persistCurrentDraftAfterImageChange(pollId);
      this.snackBar.open('Imagem adicionada à descrição.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível enviar a imagem.', 'OK', { duration: 4000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async uploadElementDescriptionImage(elementId: string, file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    const pollId = await this.ensurePollSavedForImages();
    if (!pollId) {
      return;
    }

    this.uploadingImageTarget.set(elementId);
    try {
      const image = await firstValueFrom(this.api.uploadPollImage(pollId, file));
      this.builder.addElementDescriptionImage(elementId, image);
      await this.persistCurrentDraftAfterImageChange(pollId);
      this.snackBar.open('Imagem adicionada ao item.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível enviar a imagem.', 'OK', { duration: 4000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async removePollDescriptionImage(image: PollImage): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.builder.removePollDescriptionImage(image.id);
      return;
    }

    this.uploadingImageTarget.set('poll');
    try {
      await firstValueFrom(this.api.deletePollImage(pollId, image.id));
      this.builder.removePollDescriptionImage(image.id);
      this.snackBar.open('Imagem removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a imagem.', 'OK', { duration: 3000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async removeElementDescriptionImage(elementId: string, image: PollImage): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.builder.removeElementDescriptionImage(elementId, image.id);
      return;
    }

    this.uploadingImageTarget.set(elementId);
    try {
      await firstValueFrom(this.api.deletePollImage(pollId, image.id));
      this.builder.removeElementDescriptionImage(elementId, image.id);
      this.snackBar.open('Imagem removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a imagem.', 'OK', { duration: 3000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async addManualEnrollmentNumbers(): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.snackBar.open('Salve a votação antes de adicionar matrículas.', 'OK', { duration: 3000 });
      return;
    }

    const enrollmentNumbers = this.manualEnrollmentNumbers()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (enrollmentNumbers.length === 0) {
      this.snackBar.open('Informe pelo menos uma matrícula.', 'OK', { duration: 3000 });
      return;
    }

    this.importingEligibility.set(true);
    try {
      const result = await firstValueFrom(this.api.addPollEligibilityEnrollments(pollId, { enrollmentNumbers }));
      this.eligibilityEntries.set(result.entries);
      this.manualEnrollmentNumbers.set('');
      this.snackBar.open(this.importResultLabel(result.createdCount, result.existingCount), 'OK', { duration: 3500 });
    } catch {
      this.snackBar.open('Não foi possível adicionar as matrículas.', 'OK', { duration: 4000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async importEligibilityFile(file: File | null, mode: PollEligibilityMutationMode): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!file || !pollId) {
      if (!pollId) {
        this.snackBar.open('Salve a votação antes de importar matrículas.', 'OK', { duration: 3000 });
      }
      return;
    }

    this.importingEligibility.set(true);
    try {
      const content = await file.text();
      const format = this.detectEligibilityFileFormat(file);
      const selectedHeader = format === 'csv' ? await this.selectCsvHeader(file.name, content) : undefined;
      if (format === 'csv' && !selectedHeader) {
        return;
      }

      const result = await firstValueFrom(
        this.api.importPollEligibilityEnrollments(pollId, {
          content,
          fileName: file.name,
          format,
          mode,
          selectedHeader,
        }),
      );
      this.eligibilityEntries.set(result.entries);
      this.snackBar.open(this.importResultLabel(result.createdCount, result.existingCount, mode), 'OK', {
        duration: 4000,
      });
    } catch {
      this.snackBar.open('Não foi possível importar o arquivo.', 'OK', { duration: 4000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async deleteEligibilityEnrollment(enrollmentNumber: string): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      return;
    }

    this.importingEligibility.set(true);
    try {
      await firstValueFrom(this.api.deletePollEligibilityEnrollment(pollId, enrollmentNumber));
      this.eligibilityEntries.update((entries) =>
        entries.filter((entry) => entry.enrollmentNumber !== enrollmentNumber),
      );
      this.snackBar.open('Matrícula removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a matrícula.', 'OK', { duration: 3000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async clearEligibilityEnrollments(): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId || !globalThis.confirm('Remover todas as matrículas habilitadas nesta votação?')) {
      return;
    }

    this.importingEligibility.set(true);
    try {
      const result = await firstValueFrom(this.api.clearPollEligibilityEnrollments(pollId));
      this.eligibilityEntries.set(result.entries);
      this.snackBar.open('Lista de matrículas limpa.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível limpar a lista.', 'OK', { duration: 3000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected peopleLabel(entry: PollEligibilityEnrollment): string {
    if (entry.people.length === 0) {
      return 'Nenhuma pessoa encontrada';
    }

    return entry.people.map((person) => person.name).join(', ');
  }

  protected eventDateLabel(event: EventManagerEvent): string {
    return `${this.dateTimeFormatter.format(new Date(event.startDate))} - ${this.dateTimeFormatter.format(new Date(event.endDate))}`;
  }

  protected updateSelectedResultsElement(event: MatSelectChange): void {
    this.selectedResultsElementId.set(typeof event.value === 'string' ? event.value : null);
  }

  protected updateSelectedIndividualResponse(event: MatSelectChange): void {
    this.selectedIndividualResponseId.set(typeof event.value === 'string' ? event.value : null);
  }

  protected responseVoterLabel(response: PollResultsResponse): string {
    return responseVoterLabel(response);
  }

  private async loadResults(showLoading = true): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.resetResults();
      return;
    }

    if (showLoading) {
      this.loadingResults.set(true);
    }

    try {
      const results = await firstValueFrom(this.api.getAdminPollResults(pollId));
      this.results.set(results);
      this.selectedResultsElementId.set(this.questionSummaries()[0]?.key ?? null);
      this.selectedIndividualResponseId.set(results.responses.find((response) => response.voter)?.id ?? null);
      this.openAdminResultsEvents(pollId);
    } catch {
      this.snackBar.open('Não foi possível carregar os resultados.', 'OK', { duration: 3000 });
    } finally {
      this.loadingResults.set(false);
    }
  }

  private async ensurePollSavedForImages(): Promise<string | null> {
    const draft = this.builder.draft();
    if (draft.id) {
      return draft.id;
    }

    if (!this.builder.canSave()) {
      this.snackBar.open('Informe o título da votação antes de enviar imagens.', 'OK', { duration: 3500 });
      return null;
    }

    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.createPoll(this.builder.toSaveRequest(draft)));
      this.builder.setDraft(saved);
      await this.loadPolls(false);
      return saved.id;
    } catch {
      this.snackBar.open('Não foi possível salvar a votação antes do envio.', 'OK', { duration: 4000 });
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private async persistCurrentDraftAfterImageChange(pollId: string): Promise<void> {
    const saved = await firstValueFrom(this.api.updatePoll(pollId, this.builder.toSaveRequest()));
    this.builder.setDraft(saved);
    await this.loadPolls(false);
  }

  private resetResults(): void {
    this.closeResultsEvents();
    this.results.set(null);
    this.loadingResults.set(false);
    this.selectedResultsElementId.set(null);
    this.selectedIndividualResponseId.set(null);
  }

  private openAdminResultsEvents(pollId: string): void {
    this.closeResultsEvents();
    if (!this.isBrowser) {
      return;
    }

    const source = this.api.openAdminPollResultsEvents(pollId, 0);
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

    if (!this.selectedIndividualResponseId()) {
      this.selectedIndividualResponseId.set(delta.responses.find((response) => response.voter)?.id ?? null);
    }
  }

  private async loadEligibilityEnrollments(showLoading = true): Promise<void> {
    const poll = this.builder.draft();
    if (!poll.id || poll.voterEligibilitySource !== 'enrollmentList') {
      this.eligibilityEntries.set([]);
      return;
    }

    if (showLoading) {
      this.loadingEligibility.set(true);
    }

    try {
      const result = await firstValueFrom(this.api.listPollEligibilityEnrollments(poll.id));
      this.eligibilityEntries.set(result.entries);
    } catch {
      this.snackBar.open('Não foi possível carregar as matrículas habilitadas.', 'OK', { duration: 3000 });
    } finally {
      this.loadingEligibility.set(false);
    }
  }

  private async loadPolls(showLoading = true): Promise<void> {
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

  private async loadLinkableEvents(): Promise<void> {
    this.loadingEvents.set(true);

    try {
      this.linkableEvents.set(await firstValueFrom(this.api.listLinkableEvents()));
    } catch {
      this.snackBar.open('Não foi possível carregar os eventos disponíveis.', 'OK', { duration: 3000 });
    } finally {
      this.loadingEvents.set(false);
    }
  }

  private detectEligibilityFileFormat(file: File): 'csv' | 'txt' {
    const fileName = file.name.toLowerCase();
    return file.type.includes('csv') || fileName.endsWith('.csv') ? 'csv' : 'txt';
  }

  private async selectCsvHeader(fileName: string, content: string): Promise<string | undefined> {
    const parsedCsv = parseCsv(content);
    const dialogRef = this.dialog.open(EligibilityCsvColumnDialogComponent, {
      width: '32rem',
      data: {
        fileName,
        headers: parsedCsv.headers,
        previewRows: parsedCsv.rows.slice(0, 12),
      },
    });

    return (await firstValueFrom(dialogRef.afterClosed())) ?? undefined;
  }

  private importResultLabel(
    createdCount: number,
    existingCount: number,
    mode: PollEligibilityMutationMode = 'append',
  ): string {
    if (mode === 'replace') {
      return `Lista substituída com ${createdCount} matrículas.`;
    }

    if (existingCount > 0) {
      return `${createdCount} matrículas adicionadas; ${existingCount} já estavam na lista.`;
    }

    return `${createdCount} matrículas adicionadas.`;
  }
}
