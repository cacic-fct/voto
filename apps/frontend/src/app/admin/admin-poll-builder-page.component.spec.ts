import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventManagerEvent, Poll, PollEligibilityEnrollment, PollElement, PollResults, PollSummary } from '@org/voting-contracts';
import { of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PollApiService } from '../polls/poll-api.service';
import {
  answerValueLabel,
  formatDateLabel,
  readSchedulingAnswerOrNull,
  schedulingSlots,
} from '../polls/poll-result-formatting';
import { AdminPollBuilderPageComponent } from './admin-poll-builder-page.component';
import {
  buildDemographicsCharts,
  countBuckets,
  enrollmentMetadata,
  gridCharts,
  numberRange,
  schedulingChart,
} from './admin-poll-results';
import { PollBuilderDraftService } from './poll-builder-draft.service';

describe('AdminPollBuilderPageComponent', () => {
  let fixture: ComponentFixture<AdminPollBuilderPageComponent>;
  let api: Pick<
    PollApiService,
    | 'listAdminPolls'
    | 'listLinkableEvents'
	    | 'getAdminPoll'
	    | 'getAdminPollResults'
	    | 'openAdminPollResultsEvents'
	    | 'parseResultsDelta'
	    | 'listPollEligibilityEnrollments'
	    | 'addPollEligibilityEnrollments'
	    | 'importPollEligibilityEnrollments'
	    | 'deletePollEligibilityEnrollment'
	    | 'clearPollEligibilityEnrollments'
	    | 'createPoll'
	    | 'updatePoll'
	    | 'uploadPollImage'
	    | 'deletePollImage'
	    | 'updatePollStatus'
	    | 'deletePoll'
	  >;
  let snackBar: Pick<MatSnackBar, 'open'>;
  let dialog: Pick<MatDialog, 'open'>;

  const event: EventManagerEvent = {
    id: 'event-1',
    name: 'Assembleia Geral',
    startDate: '2026-06-16T19:00:00.000Z',
    endDate: '2026-06-16T22:00:00.000Z',
    shouldCollectAttendance: true,
  };

  const pollSummary: PollSummary = {
    id: 'poll-1',
    title: 'Assembleia CACiC',
    description: 'Votação administrativa.',
    status: 'draft',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    elementCount: 1,
    responseCount: 0,
  };

  const poll: Poll = {
    ...pollSummary,
    elements: [],
  };

  const eligibilityEntry: PollEligibilityEnrollment = {
    pollId: poll.id,
    enrollmentNumber: '261200001',
    createdAt: '2026-06-16T10:00:00.000Z',
    people: [{ enrollmentNumber: '261200001', name: 'Ana Souza', email: 'ana@unesp.br' }],
  };

  beforeEach(async () => {
    api = {
      listAdminPolls: vi.fn().mockReturnValue(of([pollSummary])),
      listLinkableEvents: vi.fn().mockReturnValue(of([event])),
      getAdminPoll: vi.fn().mockReturnValue(of(poll)),
      getAdminPollResults: vi.fn().mockReturnValue(
        of({
          pollId: poll.id,
          anonymous: false,
          responseCount: 0,
          responses: [],
        }),
      ),
      openAdminPollResultsEvents: vi.fn().mockReturnValue({ close: vi.fn() } as unknown as EventSource),
      parseResultsDelta: vi.fn().mockReturnValue(null),
      listPollEligibilityEnrollments: vi.fn().mockReturnValue(of({ entries: [eligibilityEntry], totalCount: 1 })),
      addPollEligibilityEnrollments: vi.fn().mockReturnValue(
        of({ entries: [eligibilityEntry], totalCount: 1, createdCount: 1, existingCount: 0 }),
      ),
      importPollEligibilityEnrollments: vi.fn().mockReturnValue(
        of({ entries: [eligibilityEntry], totalCount: 1, createdCount: 1, existingCount: 0 }),
      ),
      deletePollEligibilityEnrollment: vi.fn().mockReturnValue(of(undefined)),
      clearPollEligibilityEnrollments: vi.fn().mockReturnValue(of({ entries: [], totalCount: 0 })),
      createPoll: vi.fn().mockReturnValue(of(poll)),
      updatePoll: vi.fn().mockReturnValue(of(poll)),
      uploadPollImage: vi.fn().mockReturnValue(
        of({
          id: 'image-1',
          url: '/api/polls/poll-1/images/image-1',
          width: 800,
          height: 450,
        }),
      ),
      deletePollImage: vi.fn().mockReturnValue(of(undefined)),
      updatePollStatus: vi.fn().mockReturnValue(of({ ...poll, status: 'published' })),
      deletePoll: vi.fn().mockReturnValue(of(undefined)),
    };
    snackBar = {
      open: vi.fn(),
    };
    dialog = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of('matricula') }),
    };

    TestBed.configureTestingModule({
      imports: [AdminPollBuilderPageComponent],
      providers: [
        { provide: PollApiService, useValue: api },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    TestBed.overrideProvider(MatSnackBar, { useValue: snackBar });
    TestBed.overrideProvider(MatDialog, { useValue: dialog });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(AdminPollBuilderPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the admin poll list', () => {
    expect(api.listAdminPolls).toHaveBeenCalled();
    expect(api.listLinkableEvents).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Área restrita');
    expect(fixture.nativeElement.textContent).toContain('Assembleia CACiC');
    expect(fixture.nativeElement.textContent).toContain('Vincular votação à evento');
  });

	  it('should save a new poll draft', async () => {
    const component = fixture.componentInstance as unknown as { save(): Promise<void> };
    const titleInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    titleInput.value = 'Nova votação';
    titleInput.dispatchEvent(new Event('input'));

    await component.save();

    expect(api.createPoll).toHaveBeenCalledWith({
      title: 'Nova votação',
      description: '',
      descriptionImages: undefined,
      status: 'draft',
      votingStyle: 'secret',
      voterEligibilitySource: 'authenticatedUsers',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      linkedEventId: undefined,
      elements: [],
	    });
	  });

  it('should add manual eligibility enrollments after filtering blank lines', async () => {
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      manualEnrollmentNumbers: { set(value: string): void; (): string };
      eligibilityEntries: { (): PollEligibilityEnrollment[] };
      addManualEnrollmentNumbers(): Promise<void>;
    };
    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });
    component.manualEnrollmentNumbers.set(' 261200001 \n\n261200002 ');

    await component.addManualEnrollmentNumbers();

    expect(api.addPollEligibilityEnrollments).toHaveBeenCalledWith('poll-1', {
      enrollmentNumbers: ['261200001', '261200002'],
    });
    expect(component.eligibilityEntries()).toEqual([eligibilityEntry]);
    expect(component.manualEnrollmentNumbers()).toBe('');
    expect(snackBar.open).toHaveBeenCalledWith('1 matrículas adicionadas.', 'OK', { duration: 3500 });
  });

  it('should require a saved poll and enrollment text before adding manual enrollments', async () => {
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      manualEnrollmentNumbers: { set(value: string): void };
      addManualEnrollmentNumbers(): Promise<void>;
    };

    await component.addManualEnrollmentNumbers();
    expect(snackBar.open).toHaveBeenCalledWith('Salve a votação antes de adicionar matrículas.', 'OK', {
      duration: 3000,
    });

    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });
    component.manualEnrollmentNumbers.set('  \n ');
    await component.addManualEnrollmentNumbers();

    expect(snackBar.open).toHaveBeenCalledWith('Informe pelo menos uma matrícula.', 'OK', { duration: 3000 });
  });

  it('should import CSV eligibility files through the selected header', async () => {
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      eligibilityEntries: { (): PollEligibilityEnrollment[] };
      importEligibilityFile(file: File | null, mode: 'append' | 'replace'): Promise<void>;
    };
    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });

    const file = {
      name: 'matriculas.csv',
      type: 'text/csv',
      text: vi.fn().mockResolvedValue('matricula,nome\n261200001,Ana'),
    } as unknown as File;

    await component.importEligibilityFile(file, 'replace');

    expect(dialog.open).toHaveBeenCalled();
    expect(api.importPollEligibilityEnrollments).toHaveBeenCalledWith('poll-1', {
      content: 'matricula,nome\n261200001,Ana',
      fileName: 'matriculas.csv',
      format: 'csv',
      mode: 'replace',
      selectedHeader: 'matricula',
    });
    expect(component.eligibilityEntries()).toEqual([eligibilityEntry]);
    expect(snackBar.open).toHaveBeenCalledWith('Lista substituída com 1 matrículas.', 'OK', { duration: 4000 });
  });

  it('should skip CSV import when the column dialog is cancelled', async () => {
    vi.mocked(dialog.open).mockReturnValue({ afterClosed: () => of(undefined) } as never);
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      importEligibilityFile(file: File | null, mode: 'append' | 'replace'): Promise<void>;
    };
    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });

    const file = {
      name: 'matriculas.csv',
      type: 'text/csv',
      text: vi.fn().mockResolvedValue('matricula\n261200001'),
    } as unknown as File;

    await component.importEligibilityFile(file, 'append');

    expect(api.importPollEligibilityEnrollments).not.toHaveBeenCalled();
  });

  it('should delete and clear eligibility enrollments after confirmation', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      eligibilityEntries: { set(value: PollEligibilityEnrollment[]): void; (): PollEligibilityEnrollment[] };
      deleteEligibilityEnrollment(enrollmentNumber: string): Promise<void>;
      clearEligibilityEnrollments(): Promise<void>;
    };
    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });
    component.eligibilityEntries.set([eligibilityEntry]);

    await component.deleteEligibilityEnrollment('261200001');
    expect(api.deletePollEligibilityEnrollment).toHaveBeenCalledWith('poll-1', '261200001');
    expect(component.eligibilityEntries()).toEqual([]);

    component.eligibilityEntries.set([eligibilityEntry]);
    await component.clearEligibilityEnrollments();
    expect(api.clearPollEligibilityEnrollments).toHaveBeenCalledWith('poll-1');
    expect(component.eligibilityEntries()).toEqual([]);

    confirm.mockRestore();
  });

  it('should build answer labels, voter rows, question summaries, and demographics charts', () => {
    const choiceElement: PollElement = {
      id: 'choice',
      type: 'multipleChoice',
      title: 'Escolhas',
      required: true,
      options: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }],
    };
    const gridElement: PollElement = {
      id: 'grid',
      type: 'singleSelectionGrid',
      title: 'Grade',
      required: true,
      options: [],
      settings: {
        grid: {
          rows: [{ id: 'row', label: 'Linha' }],
          columns: [{ id: 'col', label: 'Coluna' }],
        },
      },
    };
    const schedulingElement: PollElement = {
      id: 'schedule',
      type: 'scheduling',
      title: 'Agenda',
      required: false,
      options: [],
      settings: {
        scheduling: {
          hostName: '',
          location: '',
          timezone: 'America/Sao_Paulo',
          durationMinutes: 30,
          slotIntervalMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          inviteeMode: 'optional',
          maxInvitees: 1,
          availability: [{ id: 'window', date: '2026-06-24', startTime: '09:00', endTime: '10:00' }],
        },
      },
    };
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      results: { set(value: PollResults): void };
      voterRows: () => { enrollmentYear: string; course: string; name: string }[];
      demographicsCharts: () => { title: string; buckets: { label: string; value: number }[] }[];
      questionSummaries: () => { answeredCount: number; charts: { buckets: { label: string; value: number }[] }[] }[];
      responseVoterLabel(response: PollResults['responses'][number]): string;
      peopleLabel(entry: PollEligibilityEnrollment): string;
      eventDateLabel(event: EventManagerEvent): string;
    };
    component.builder.setDraft({ ...poll, elements: [choiceElement, gridElement, schedulingElement] });
    component.results.set({
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [
        {
          id: 'response-1',
          submittedAt: '2026-06-18T12:00:00.000Z',
          voter: {
            userId: 'user-1',
            name: 'Ana Souza',
            preferredUsername: 'ana',
            email: 'ana@unesp.br',
            unespRole: 'aluno-graduacao',
            enrollmentNumber: '261200001',
          },
          answers: [
            { elementId: 'choice', value: ['yes'] },
            { elementId: 'grid', value: { row: 'col' } },
            {
              elementId: 'schedule',
              value: { slotId: 'window:09:00', invitees: [{ name: 'Bruno', email: 'bruno@unesp.br' }] },
            },
          ],
        },
      ],
    });

    expect(answerValueLabel(choiceElement, ['yes', 'missing'])).toBe('Sim, missing');
    expect(answerValueLabel(gridElement, { row: 'col' })).toBe('Linha: Coluna');
    expect(answerValueLabel(schedulingElement, { slotId: 'window:09:00' })).toContain('09:00 - 09:30');
    expect(answerValueLabel(choiceElement, undefined)).toBe('Sem resposta');
    expect(component.responseVoterLabel({ id: 'empty', submittedAt: '', answers: [] })).toBe('Identidade não disponível');
    expect(component.peopleLabel({ ...eligibilityEntry, people: [] })).toBe('Nenhuma pessoa encontrada');
    expect(component.peopleLabel(eligibilityEntry)).toBe('Ana Souza');
    expect(component.eventDateLabel(event)).toContain('16/06/2026');
    expect(component.voterRows()[0]).toMatchObject({
      name: 'Ana Souza',
      enrollmentYear: '2026',
      course: 'Ciência da Computação',
    });
    expect(component.demographicsCharts()).toHaveLength(3);
    expect(component.questionSummaries()[0]).toMatchObject({
      answeredCount: 1,
      charts: [{ buckets: [{ label: 'Sim', value: 1 }, { label: 'Não', value: 0 }] }],
    });
  });

  it('should expose computed event, question, text, and individual selections', () => {
    const linkedEvent = {
      id: 'archived-event',
      name: 'Evento arquivado',
      startDate: '2026-06-10T10:00:00.000Z',
      endDate: '2026-06-10T12:00:00.000Z',
    };
    const textElement: PollElement = {
      id: 'text',
      type: 'shortText',
      title: 'Comentário',
      required: false,
      options: [],
    };
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      linkableEvents: { set(value: EventManagerEvent[]): void };
      results: { set(value: PollResults): void };
      selectedResultsElementId: { set(value: string | null): void };
      selectedIndividualResponseId: { set(value: string | null): void };
      eventOptions: () => EventManagerEvent[];
      selectedQuestionElementId: () => string | null;
      selectedIndividualResponse: () => PollResults['responses'][number] | null;
      selectedIndividualAnswers: () => { valueLabel: string }[];
      textQuestionSummaries: () => { textAnswers: string[] }[];
      answerSummaryCharts: () => unknown[];
      updateSelectedResultsElement(event: { value: unknown }): void;
      updateSelectedIndividualResponse(event: { value: unknown }): void;
      newPoll(): void;
    };

    component.builder.setDraft({ ...poll, linkedEvent: undefined });
    component.linkableEvents.set([event]);
    expect(component.eventOptions()).toEqual([event]);
    component.builder.setDraft({ ...poll, linkedEvent: event });
    expect(component.eventOptions()).toEqual([event]);

    component.builder.setDraft({ ...poll, linkedEvent, elements: [textElement] });
    component.linkableEvents.set([]);
    expect(component.eventOptions()[0]).toMatchObject({ id: 'archived-event', shouldCollectAttendance: false });

    component.results.set({ pollId: poll.id, anonymous: false, responseCount: 0, responses: [] });
    component.selectedIndividualResponseId.set('missing');
    expect(component.selectedIndividualResponse()).toBeNull();
    expect(component.selectedIndividualAnswers()).toEqual([]);
    component.results.set({
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [{ id: 'anonymous-response', submittedAt: '2026-06-18T12:00:00.000Z', answers: [] }],
    });
    expect(component.selectedIndividualResponse()).toBeNull();

    component.results.set({
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [
        {
          id: 'response-1',
          submittedAt: '2026-06-18T12:00:00.000Z',
          voter: { userId: 'user-1', preferredUsername: 'ana' },
          answers: [{ elementId: 'text', value: 'Ótimo' }],
        },
      ],
    });
    const textQuestionKey = component.selectedQuestionElementId();
    component.updateSelectedResultsElement({ value: textQuestionKey });
    component.updateSelectedIndividualResponse({ value: 'response-1' });

    expect(component.selectedQuestionElementId()).toBe(textQuestionKey);
    expect(component.selectedIndividualResponse()?.id).toBe('response-1');
    expect(component.selectedIndividualAnswers()).toEqual([{ element: textElement, valueLabel: 'Ótimo' }]);
    expect(component.textQuestionSummaries()[0].textAnswers).toEqual(['Ótimo']);
    expect(component.answerSummaryCharts()).toEqual([]);

    component.updateSelectedResultsElement({ value: 1 });
    component.updateSelectedIndividualResponse({ value: 1 });
    expect(component.selectedQuestionElementId()).toBe(textQuestionKey);

    component.newPoll();
    expect(component.selectedQuestionElementId()).toBeNull();
  });

  it('should select, update status, delete, and handle failures for polls', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      saving: { (): boolean };
      selectPoll(id: string): Promise<void>;
      setStatus(status: 'published' | 'closed' | 'draft'): Promise<void>;
      deletePoll(): Promise<void>;
      save(): Promise<void>;
    };

    await component.selectPoll('poll-1');
    expect(api.getAdminPoll).toHaveBeenCalledWith('poll-1');
    expect(component.saving()).toBe(false);

    await component.setStatus('published');
    expect(api.updatePollStatus).toHaveBeenCalledWith('poll-1', 'published');

    await component.deletePoll();
    expect(api.deletePoll).toHaveBeenCalledWith('poll-1');

    component.builder.newPoll();
    await component.save();
    expect(snackBar.open).toHaveBeenCalledWith('Informe o título da votação.', 'OK', { duration: 3000 });

    vi.mocked(api.getAdminPoll).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.selectPoll('missing');
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível abrir a votação.', 'OK', { duration: 3000 });

    confirm.mockRestore();
  });

  it('should merge live admin result deltas and close event sources', async () => {
    const source = { close: vi.fn(), onmessage: undefined as ((event: MessageEvent<string>) => void) | undefined };
    const initialResults: PollResults = {
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [{ id: 'response-1', submittedAt: '2026-06-18T12:00:00.000Z', answers: [] }],
    };
    const delta = {
      pollId: poll.id,
      responseCount: 2,
      responses: [
        {
          id: 'response-2',
          submittedAt: '2026-06-18T12:05:00.000Z',
          voter: { userId: 'user-2', preferredUsername: 'bruno' },
          answers: [],
        },
      ],
    };
    vi.mocked(api.getAdminPollResults).mockReturnValueOnce(of(initialResults));
    vi.mocked(api.openAdminPollResultsEvents).mockReturnValueOnce(source as unknown as EventSource);
    vi.mocked(api.parseResultsDelta).mockReturnValueOnce(delta);
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      results: { (): PollResults | null; set(value: PollResults | null): void };
      selectedIndividualResponseId: { (): string | null; set(value: string | null): void };
      loadResults(showLoading?: boolean): Promise<void>;
      ngOnDestroy(): void;
    };
    component.builder.setDraft({ ...poll, id: 'poll-1' });

    await component.loadResults();
    source.onmessage?.({ data: JSON.stringify(delta) } as MessageEvent<string>);

    expect(api.openAdminPollResultsEvents).toHaveBeenCalledWith('poll-1', 0);
    expect(component.results()?.responseCount).toBe(2);
    expect(component.results()?.responses.map((item) => item.id)).toEqual(['response-1', 'response-2']);
    expect(component.selectedIndividualResponseId()).toBe('response-2');

    component.ngOnDestroy();
    expect(source.close).toHaveBeenCalled();
  });

  it('should build charts for scalar, raw, dropdown, grid, and scheduling answers', () => {
    const elements: PollElement[] = [
      {
        id: 'dropdown',
        type: 'selectionDropdown',
        title: 'Turno',
        required: true,
        options: [{ id: 'morning', label: 'Manhã' }],
      },
      {
        id: 'scale',
        type: 'linearScale',
        title: 'Nota',
        required: true,
        options: [],
        settings: { linearScale: { min: 0, max: 2 } },
      },
      {
        id: 'stars',
        type: 'starRating',
        title: 'Estrelas',
        required: false,
        options: [],
        settings: { starRating: { max: 3 } },
      },
      { id: 'date', type: 'date', title: 'Data', required: false, options: [] },
      { id: 'time', type: 'time', title: 'Hora', required: false, options: [] },
      {
        id: 'grid',
        type: 'multipleSelectionGrid',
        title: 'Grade',
        required: false,
        options: [],
        settings: {
          grid: {
            rows: [{ id: 'row', label: 'Linha' }],
            columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          },
        },
      },
      {
        id: 'schedule',
        type: 'scheduling',
        title: 'Agenda',
        required: false,
        options: [],
        settings: {
          scheduling: {
            hostName: '',
            location: '',
            timezone: 'America/Sao_Paulo',
            durationMinutes: 30,
            slotIntervalMinutes: 30,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            inviteeMode: 'optional',
            maxInvitees: 1,
            availability: [{ id: 'window', date: '2026-06-24', startTime: '09:00', endTime: '10:00' }],
          },
        },
      },
    ];
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      results: { set(value: PollResults): void };
      questionSummaries: () => { element: PollElement; charts: { buckets: { label: string; value: number }[] }[] }[];
      answerSummaryCharts: () => unknown[];
    };
    component.builder.setDraft({ ...poll, elements });
    component.results.set({
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [
        {
          id: 'response-1',
          submittedAt: '2026-06-18T12:00:00.000Z',
          answers: [
            { elementId: 'dropdown', value: 'morning' },
            { elementId: 'scale', value: 2 },
            { elementId: 'stars', value: 3 },
            { elementId: 'date', value: '2026-06-24' },
            { elementId: 'time', value: '09:00' },
            { elementId: 'grid', value: { row: ['a', 'b'] } },
            { elementId: 'schedule', value: { slotId: 'missing-slot' } },
          ],
        },
      ],
    });

    const summaries = component.questionSummaries();
    expect(summaries.find((summary) => summary.element.id === 'dropdown')?.charts[0].buckets).toEqual([
      { label: 'Manhã', value: 1 },
    ]);
    expect(summaries.find((summary) => summary.element.id === 'scale')?.charts[0].buckets).toEqual([
      { label: '0', value: 0 },
      { label: '1', value: 0 },
      { label: '2', value: 1 },
    ]);
    expect(summaries.find((summary) => summary.element.id === 'grid')?.charts[0].buckets).toEqual([
      { label: 'A', value: 1 },
      { label: 'B', value: 1 },
    ]);
    expect(summaries.find((summary) => summary.element.id === 'schedule')?.charts[0].buckets.at(-1)).toEqual({
      label: 'missing-slot',
      value: 1,
    });
    expect(component.answerSummaryCharts().length).toBeGreaterThan(5);
  });

  it('should cover remaining result helper fallbacks', () => {
    const component = fixture.componentInstance as unknown as {
      results: { set(value: PollResults | null): void };
    };
    const emptyElement: PollElement = { id: 'empty', type: 'section', title: 'Seção', required: false, options: [] };
    const gridElement: PollElement = {
      id: 'grid',
      type: 'singleSelectionGrid',
      title: 'Grade',
      required: true,
      options: [],
      settings: { grid: { rows: [{ id: 'row', label: 'Linha' }], columns: [] } },
    };

    component.results.set(null);
    expect(buildDemographicsCharts([], false)).toEqual([]);
    expect(answerValueLabel(emptyElement, { x: 1 })).toBe('Sem resposta');
    expect(answerValueLabel(gridElement, { row: ['a', 'b'] })).toBe('Linha: a, b');
    expect(gridCharts(gridElement, [null])[0].buckets).toEqual([]);
    expect(schedulingSlots(emptyElement)).toEqual([]);
    expect(formatDateLabel('invalid')).toBe('invalid');
    expect(numberRange(5, 3)).toEqual([]);
    expect(countBuckets(['', 'B', 'A', 'B'])).toEqual([
      { label: 'B', value: 2 },
      { label: 'A', value: 1 },
      { label: 'Não informado', value: 1 },
    ]);
    expect(enrollmentMetadata('123')).toBeNull();
    expect(enrollmentMetadata('263400001')).toEqual({
      yearLabel: '2026',
      courseLabel: 'Curso desconhecido (34)',
    });
  });

  it('should cover admin failure and fallback branches', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const component = fixture.componentInstance as unknown as {
      builder: PollBuilderDraftService;
      linkableEvents: { set(value: EventManagerEvent[]): void };
      eligibilityEntries: { (): PollEligibilityEnrollment[] };
      results: { (): PollResults | null; set(value: PollResults | null): void };
      isBrowser: boolean;
      eventOptions: () => EventManagerEvent[];
      save(): Promise<void>;
      loadResults(showLoading?: boolean): Promise<void>;
      applyResultsDelta(delta: { pollId: string; responseCount: number; responses: PollResults['responses'] }): void;
      loadEligibilityEnrollments(showLoading?: boolean): Promise<void>;
      loadPolls(showLoading?: boolean): Promise<void>;
      loadLinkableEvents(): Promise<void>;
      setStatus(status: 'published' | 'closed' | 'draft'): Promise<void>;
      deletePoll(): Promise<void>;
      updateLinkedEvent(event: { value: string }): void;
      updateVoterEligibilitySource(event: { value: string }): void;
      updateManualEnrollmentNumbers(event: Event): void;
      addManualEnrollmentNumbers(): Promise<void>;
      importEligibilityFile(file: File | null, mode: 'append' | 'replace'): Promise<void>;
      deleteEligibilityEnrollment(enrollmentNumber: string): Promise<void>;
      clearEligibilityEnrollments(): Promise<void>;
      importResultLabel(createdCount: number, existingCount: number, mode?: 'append' | 'replace'): string;
    };
    const schedulingElement: PollElement = {
      id: 'schedule',
      type: 'scheduling',
      title: 'Agenda',
      required: false,
      options: [],
      settings: {
        scheduling: {
          hostName: '',
          location: '',
          timezone: 'America/Sao_Paulo',
          durationMinutes: 30,
          slotIntervalMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          inviteeMode: 'optional',
          maxInvitees: 1,
          availability: [{ id: 'window', date: '2026-06-24', startTime: '09:00', endTime: '10:00' }],
        },
      },
    };

    component.builder.newPoll();
    component.linkableEvents.set([event]);
    expect(component.eventOptions()).toEqual([event]);
    await component.loadResults();
    expect(component.results()).toBeNull();
    await component.setStatus('published');
    await component.deletePoll();
    await component.deleteEligibilityEnrollment('missing');
    await component.clearEligibilityEnrollments();
    await component.importEligibilityFile(null, 'append');

    const textarea = document.createElement('textarea');
    textarea.value = '123';
    component.updateManualEnrollmentNumbers({ target: textarea } as unknown as Event);
    component.updateLinkedEvent({ value: event.id });
    component.updateVoterEligibilitySource({ value: 'enrollmentList' });

    component.builder.setDraft({ ...poll, id: 'poll-1', voterEligibilitySource: 'enrollmentList' });
    vi.mocked(api.updatePoll).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.save();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível salvar. Confira os itens e opções.', 'OK', {
      duration: 4000,
    });

    vi.mocked(api.updatePollStatus).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.setStatus('published');
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível atualizar o status.', 'OK', { duration: 3000 });

    confirm.mockReturnValue(true);
    vi.mocked(api.deletePoll).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.deletePoll();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível excluir a votação.', 'OK', { duration: 3000 });

    vi.mocked(api.addPollEligibilityEnrollments).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.addManualEnrollmentNumbers();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível adicionar as matrículas.', 'OK', { duration: 4000 });

    vi.mocked(api.importPollEligibilityEnrollments).mockReturnValueOnce(throwError(() => new Error('offline')));
    const file = {
      name: 'matriculas.txt',
      type: 'text/plain',
      text: vi.fn().mockResolvedValue('123'),
    } as unknown as File;
    await component.importEligibilityFile(file, 'append');
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível importar o arquivo.', 'OK', { duration: 4000 });

    vi.mocked(api.getAdminPollResults).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.loadResults();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível carregar os resultados.', 'OK', { duration: 3000 });

    vi.mocked(api.getAdminPollResults).mockReturnValueOnce(
      of({ pollId: 'poll-1', anonymous: false, responseCount: 0, responses: [] }),
    );
    component.isBrowser = false;
    await component.loadResults();
    expect(api.openAdminPollResultsEvents).not.toHaveBeenCalled();

    component.results.set(null);
    component.applyResultsDelta({ pollId: 'poll-1', responseCount: 1, responses: [] });
    expect(component.results()).toBeNull();
    component.results.set({ pollId: 'poll-1', anonymous: false, responseCount: 1, responses: [] });
    component.applyResultsDelta({ pollId: 'other', responseCount: 2, responses: [] });
    expect(component.results()?.responseCount).toBe(1);

    vi.mocked(api.listPollEligibilityEnrollments).mockReturnValueOnce(of({ entries: [eligibilityEntry], totalCount: 1 }));
    await component.loadEligibilityEnrollments(true);
    expect(component.eligibilityEntries()).toEqual([eligibilityEntry]);
    vi.mocked(api.listPollEligibilityEnrollments).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.loadEligibilityEnrollments(true);
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível carregar as matrículas habilitadas.', 'OK', {
      duration: 3000,
    });

    vi.mocked(api.deletePollEligibilityEnrollment).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.deleteEligibilityEnrollment('261200001');
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível remover a matrícula.', 'OK', { duration: 3000 });

    vi.mocked(api.clearPollEligibilityEnrollments).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.clearEligibilityEnrollments();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível limpar a lista.', 'OK', { duration: 3000 });

    vi.mocked(api.listAdminPolls).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.loadPolls(true);
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível carregar a lista de votações.', 'OK', {
      duration: 3000,
    });
    vi.mocked(api.listLinkableEvents).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.loadLinkableEvents();
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível carregar os eventos disponíveis.', 'OK', {
      duration: 3000,
    });

    expect(schedulingChart(schedulingElement, [null]).buckets.every((bucket) => bucket.value === 0)).toBe(true);
    expect(gridCharts({ ...schedulingElement, type: 'singleSelectionGrid', settings: undefined }, [])).toEqual([]);
    expect(answerValueLabel(schedulingElement, {})).toBe('Sem resposta');
    expect(readSchedulingAnswerOrNull(null)).toBeNull();
    expect(readSchedulingAnswerOrNull({})).toBeNull();
    expect(component.importResultLabel(2, 3)).toBe('2 matrículas adicionadas; 3 já estavam na lista.');

    confirm.mockRestore();
  });
});
