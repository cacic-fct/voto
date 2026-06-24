import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  EventManagerEvent,
  PollAnswerValue,
  PollElement,
  PollEligibilityEnrollment,
  PollEligibilityMutationMode,
  PollImage,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollSchedulingAnswer,
  PollSchedulingAvailabilityWindow,
  PollSchedulingSettings,
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
import {
  AdminResultsChartComponent,
  AdminResultsChartConfig,
  AdminResultsChartType,
} from './admin-results-chart.component';
import { PollBuilderDraftService } from './poll-builder-draft.service';

type ResultsVoterRow = {
  response: PollResultsResponse;
  name: string;
  email: string;
  unespRole: string;
  enrollmentNumber: string;
  enrollmentYear: string;
  course: string;
};

type QuestionResultSummary = {
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

@Component({
  selector: 'app-admin-poll-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    AdminResultsChartComponent,
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
  private readonly numberFormatter = new Intl.NumberFormat('pt-BR');
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
    this.builder.draft().elements.filter((element) => this.builder.isAnswerElement(element.type)),
  );
  protected readonly questionSummaries = computed(() =>
    this.answerElements().map((element) => this.buildQuestionSummary(element)),
  );
  protected readonly selectedQuestionSummary = computed(() => {
    const summaries = this.questionSummaries();
    const selectedId = this.selectedResultsElementId();
    return summaries.find((summary) => summary.element.id === selectedId) ?? summaries[0] ?? null;
  });
  protected readonly selectedQuestionElementId = computed(() => this.selectedQuestionSummary()?.element.id ?? null);
  protected readonly voterRows = computed(() =>
    (this.results()?.responses ?? []).map((response) => this.toVoterRow(response)),
  );
  protected readonly demographicsCharts = computed(() => this.buildDemographicsCharts());
  protected readonly answerSummaryCharts = computed(() =>
    this.questionSummaries().flatMap((summary) => summary.charts.slice(0, summary.element.type.includes('Grid') ? 2 : 1)),
  );
  protected readonly textQuestionSummaries = computed(() =>
    this.questionSummaries().filter((summary) => summary.textAnswers.length > 0),
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

    return this.answerElements().map((element) => ({
      element,
      valueLabel: this.answerValueLabel(element, this.findAnswerValue(response, element.id)),
    }));
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
    const voter = response.voter;
    return voter?.name || voter?.preferredUsername || voter?.email || 'Identidade não disponível';
  }

  protected answerValueLabel(element: PollElement, value: PollAnswerValue | undefined): string {
    if (this.isEmptyAnswerValue(value)) {
      return 'Sem resposta';
    }

    if (typeof value === 'number') {
      return this.numberFormatter.format(value);
    }

    if (typeof value === 'string') {
      return this.optionLabel(element, value) ?? value;
    }

    if (Array.isArray(value)) {
      return value.map((optionId) => this.optionLabel(element, optionId) ?? optionId).join(', ');
    }

    const recordValue = this.asRecord(value);
    if (recordValue && element.settings?.grid) {
      return element.settings.grid.rows
        .map((row) => {
          const rawValue = recordValue[row.id];
          const rowValue = Array.isArray(rawValue)
            ? rawValue.map((columnId) => this.gridColumnLabel(element, String(columnId))).join(', ')
            : typeof rawValue === 'string'
              ? this.gridColumnLabel(element, rawValue)
              : '';
          return rowValue ? `${row.label}: ${rowValue}` : '';
        })
        .filter(Boolean)
        .join('; ');
    }

    if (recordValue && element.type === 'scheduling') {
      return this.schedulingAnswerLabel(element, recordValue);
    }

    return 'Sem resposta';
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
      this.selectedResultsElementId.set(this.answerElements()[0]?.id ?? null);
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

  private buildQuestionSummary(element: PollElement): QuestionResultSummary {
    const responses = this.results()?.responses ?? [];
    const answerEntries = responses
      .map((response) => ({
        response,
        value: this.findAnswerValue(response, element.id),
      }))
      .filter((entry) => !this.isEmptyAnswerValue(entry.value));

    return {
      element,
      answeredCount: answerEntries.length,
      charts: this.buildQuestionCharts(element, answerEntries.map((entry) => entry.value)),
      textAnswers: this.buildQuestionTextAnswers(element, answerEntries.map((entry) => entry.value)),
      individualAnswers: answerEntries.map((entry) => ({
        responseId: entry.response.id,
        voterLabel: this.responseVoterLabel(entry.response),
        valueLabel: this.answerValueLabel(element, entry.value),
      })),
    };
  }

  private buildQuestionCharts(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig[] {
    switch (element.type) {
      case 'singleChoice':
      case 'selectionDropdown':
        return [
          this.optionChart(element, values, 'pie', 'radio_button_checked', 'Distribuição de escolhas únicas.'),
        ];
      case 'multipleChoice':
        return [this.optionChart(element, values, 'horizontalBar', 'check_box', 'Total por opção marcada.')];
      case 'linearScale':
      case 'starRating':
        return [this.scalarChart(element, values)];
      case 'date':
      case 'time':
        return [this.rawValueChart(element, values, 'horizontalBar', 'event', 'Frequência por resposta.')];
      case 'scheduling':
        return [this.schedulingChart(element, values)];
      case 'singleSelectionGrid':
      case 'multipleSelectionGrid':
        return this.gridCharts(element, values);
      case 'shortText':
      case 'longText':
      case 'section':
      case 'statement':
        return [];
    }
  }

  private buildQuestionTextAnswers(element: PollElement, values: (PollAnswerValue | undefined)[]): string[] {
    if (element.type !== 'shortText' && element.type !== 'longText') {
      return [];
    }

    return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  private optionChart(
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

  private scalarChart(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig {
    const counts = new Map<string, number>();
    const allowedValues =
      element.type === 'linearScale' && element.settings?.linearScale
        ? this.numberRange(element.settings.linearScale.min, element.settings.linearScale.max)
        : element.type === 'starRating' && element.settings?.starRating
          ? this.numberRange(1, element.settings.starRating.max)
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

  private rawValueChart(
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
      buckets: this.countBuckets(
        values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ),
      emptyText: 'Nenhuma resposta registrada para esta pergunta.',
    };
  }

  private schedulingChart(
    element: PollElement,
    values: (PollAnswerValue | undefined)[],
  ): AdminResultsChartConfig {
    const slots = this.schedulingSlots(element);
    const labels = new Map(slots.map((slot) => [slot.id, slot.label]));
    const counts = new Map(slots.map((slot) => [slot.id, 0]));

    for (const value of values) {
      const answer = this.readSchedulingAnswer(value);
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

  private gridCharts(element: PollElement, values: (PollAnswerValue | undefined)[]): AdminResultsChartConfig[] {
    const grid = element.settings?.grid;
    if (!grid) {
      return [];
    }

    return grid.rows.map((row) => {
      const counts = new Map(grid.columns.map((column) => [column.id, 0]));

      for (const value of values) {
        const recordValue = this.asRecord(value);
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

  private buildDemographicsCharts(): AdminResultsChartConfig[] {
    const rows = this.voterRows();
    if (rows.length === 0 || !this.individualResultsAvailable()) {
      return [];
    }

    return [
      {
        title: 'Vínculo Unesp',
        subtitle: 'Distribuição por unespRole informado no login.',
        icon: 'badge',
        type: 'pie',
        buckets: this.countBuckets(rows.map((row) => row.unespRole)),
      },
      {
        title: 'Ano de ingresso',
        subtitle: 'Calculado pelos dois primeiros dígitos da matrícula.',
        icon: 'calendar_month',
        type: 'verticalBar',
        buckets: this.countBuckets(rows.map((row) => row.enrollmentYear)),
      },
      {
        title: 'Curso',
        subtitle: 'Código 12 é Ciência da Computação; demais códigos ficam identificados como desconhecidos.',
        icon: 'school',
        type: 'horizontalBar',
        buckets: this.countBuckets(rows.map((row) => row.course)),
      },
    ];
  }

  private toVoterRow(response: PollResultsResponse): ResultsVoterRow {
    const voter = response.voter;
    const metadata = this.enrollmentMetadata(voter?.enrollmentNumber);

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

  private enrollmentMetadata(enrollmentNumber?: string): { yearLabel: string; courseLabel: string } | null {
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

  private findAnswerValue(response: PollResultsResponse, elementId: string): PollAnswerValue | undefined {
    return response.answers.find((answer) => answer.elementId === elementId)?.value;
  }

  private optionLabel(element: PollElement, optionId: string): string | undefined {
    return element.options.find((option) => option.id === optionId)?.label;
  }

  private gridColumnLabel(element: PollElement, columnId: string): string {
    return element.settings?.grid?.columns.find((column) => column.id === columnId)?.label ?? columnId;
  }

  private schedulingAnswerLabel(element: PollElement, value: Record<string, unknown>): string {
    const answer = this.readSchedulingAnswer(value);
    if (!answer) {
      return 'Sem resposta';
    }

    const slot = this.schedulingSlots(element).find((item) => item.id === answer.slotId);
    const inviteeLabel =
      answer.invitees.length > 0
        ? ` · Convidados: ${answer.invitees.map((invitee) => invitee.email ? `${invitee.name} (${invitee.email})` : invitee.name).join(', ')}`
        : '';

    return `${slot?.label ?? answer.slotId}${inviteeLabel}`;
  }

  private readSchedulingAnswer(value: unknown): PollSchedulingAnswer | null {
    const recordValue = this.asRecord(value);
    if (!recordValue) {
      return null;
    }

    const slotId = typeof recordValue['slotId'] === 'string' ? recordValue['slotId'] : '';
    if (!slotId) {
      return null;
    }

    const invitees = Array.isArray(recordValue['invitees'])
      ? recordValue['invitees']
          .map((invitee) => this.asRecord(invitee))
          .filter((invitee): invitee is Record<string, unknown> => invitee !== null)
          .map((invitee) => ({
            name: typeof invitee['name'] === 'string' ? invitee['name'] : '',
            email: typeof invitee['email'] === 'string' ? invitee['email'] : undefined,
          }))
          .filter((invitee) => invitee.name.trim().length > 0)
      : [];

    return {
      slotId,
      invitees,
    };
  }

  private schedulingSlots(element: PollElement): { id: string; label: string }[] {
    const settings = element.settings?.scheduling;
    if (!settings) {
      return [];
    }

    return settings.availability.flatMap((availability) => this.schedulingSlotsForAvailability(settings, availability));
  }

  private schedulingSlotsForAvailability(
    settings: PollSchedulingSettings,
    availability: PollSchedulingAvailabilityWindow,
  ): { id: string; label: string }[] {
    const slots: { id: string; label: string }[] = [];
    const windowStart = this.timeToMinutes(availability.startTime);
    const windowEnd = this.timeToMinutes(availability.endTime);
    const firstStart = windowStart + settings.bufferBeforeMinutes;
    const lastStart = windowEnd - settings.durationMinutes - settings.bufferAfterMinutes;

    for (
      let startMinutes = firstStart;
      startMinutes <= lastStart;
      startMinutes += settings.slotIntervalMinutes
    ) {
      const endMinutes = startMinutes + settings.durationMinutes;
      slots.push({
        id: this.schedulingSlotId(availability, startMinutes),
        label: `${this.formatDateLabel(availability.date)} · ${this.formatTimeMinutes(startMinutes)} - ${this.formatTimeMinutes(endMinutes)}`,
      });
    }

    return slots;
  }

  private schedulingSlotId(availability: PollSchedulingAvailabilityWindow, startMinutes: number): string {
    return `${availability.id}:${this.formatTimeMinutes(startMinutes)}`;
  }

  private formatDateLabel(value: string): string {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) {
      return value;
    }

    const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(
      new Date(Date.UTC(year, month - 1, day, 12)),
    );
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

  private countBuckets(values: readonly string[]): { label: string; value: number }[] {
    const counts = new Map<string, number>();
    for (const value of values) {
      const label = value.trim() || 'Não informado';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'pt-BR'));
  }

  private numberRange(min: number, max: number): number[] {
    return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
