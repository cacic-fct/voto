import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Poll, PollElement, PollResponse, PollResults } from '@org/voting-contracts';
import { of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PollApiService } from './poll-api.service';
import { PollVotePageComponent } from './poll-vote-page.component';
import { answerValueLabels } from './poll-result-formatting';

describe('PollVotePageComponent', () => {
  let fixture: ComponentFixture<PollVotePageComponent>;
  let api: Pick<
    PollApiService,
    | 'getPublicPoll'
    | 'getMyPollResponse'
    | 'getPublicPollResults'
    | 'openPublicPollResultsEvents'
    | 'parseResultsDelta'
    | 'submitResponse'
  >;

  const poll: Poll = {
    id: 'poll-1',
    title: 'Eleição CACiC',
    description: 'Escolha uma opção.',
    status: 'published',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    publishedAt: '2026-06-01T10:00:00.000Z',
    elements: [
      {
        id: 'element-1',
        type: 'shortText',
        title: 'Nome',
        description: '',
        required: true,
        options: [],
      },
    ],
  };

  const response: PollResponse = {
    id: 'response-1',
    pollId: 'poll-1',
    submittedAt: '2026-06-01T10:05:00.000Z',
    answers: [{ elementId: 'element-1', value: 'Maria' }],
  };

  beforeEach(async () => {
    api = {
      getPublicPoll: vi.fn().mockReturnValue(of(poll)),
      getMyPollResponse: vi.fn().mockReturnValue(
        of({
          hasSubmitted: false,
          canEdit: false,
          canSubmitAnother: false,
        }),
      ),
      getPublicPollResults: vi.fn().mockReturnValue(
        of({
          pollId: poll.id,
          anonymous: false,
          responseCount: 0,
          responses: [],
        }),
      ),
      openPublicPollResultsEvents: vi.fn().mockReturnValue({ close: vi.fn() } as unknown as EventSource),
      parseResultsDelta: vi.fn().mockReturnValue(null),
      submitResponse: vi.fn().mockReturnValue(of(response)),
    };

    await TestBed.configureTestingModule({
      imports: [PollVotePageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: vi.fn((name: string) => (name === 'id' ? 'poll-1' : null)),
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PollVotePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should load the selected poll', () => {
    expect(api.getPublicPoll).toHaveBeenCalledWith('poll-1');
    expect(fixture.nativeElement.textContent).toContain('Eleição CACiC');
  });

  it('should submit answers', async () => {
    const component = fixture.componentInstance as unknown as {
      setTextAnswer(elementId: string, event: Event): void;
      submit(poll: Poll): Promise<void>;
    };
    const input = document.createElement('input');
    input.value = 'Maria';
    component.setTextAnswer('element-1', { target: input } as unknown as Event);

    await component.submit(poll);

    expect(api.submitResponse).toHaveBeenCalledWith('poll-1', {
      answers: [{ elementId: 'element-1', value: 'Maria' }],
    });
  });

  it('should keep the form available for multiple responses after submit', async () => {
    const component = fixture.componentInstance as unknown as {
      setTextAnswer(elementId: string, event: Event): void;
      submit(poll: Poll): Promise<void>;
    };
    const input = document.createElement('input');
    input.value = 'Maria';
    component.setTextAnswer('element-1', { target: input } as unknown as Event);

    await component.submit({
      ...poll,
      allowMultipleResponses: true,
    });
    fixture.detectChanges();

    expect(api.submitResponse).toHaveBeenCalledWith('poll-1', {
      answers: [{ elementId: 'element-1', value: 'Maria' }],
    });
    expect(fixture.nativeElement.textContent).toContain('Enviar nova resposta');
  });

  it('should submit extended answer values', async () => {
    const component = fixture.componentInstance as unknown as {
      setNumberAnswer(elementId: string, value: number): void;
      setSingleGridAnswer(elementId: string, rowId: string, columnId: string): void;
      toggleMultipleGridAnswer(
        elementId: string,
        rowId: string,
        columnId: string,
        event: { checked: boolean },
      ): void;
      setSchedulingSlot(elementId: string, slotId: string): void;
      setSchedulingInvitee(elementId: string, index: number, field: 'name' | 'email', event: Event): void;
      submit(poll: Poll): Promise<void>;
    };
    const extendedPoll: Poll = {
      ...poll,
      elements: [
        {
          id: 'scale',
          type: 'linearScale',
          title: 'Confiança',
          required: true,
          options: [],
          settings: {
            linearScale: { min: 1, max: 5 },
          },
        },
        {
          id: 'single-grid',
          type: 'singleSelectionGrid',
          title: 'Prioridade',
          required: true,
          options: [],
          settings: {
            grid: {
              rows: [{ id: 'row-1', label: 'Comunicação' }],
              columns: [{ id: 'high', label: 'Alta' }, { id: 'low', label: 'Baixa' }],
            },
          },
        },
        {
          id: 'multiple-grid',
          type: 'multipleSelectionGrid',
          title: 'Disponibilidade',
          required: false,
          options: [],
          settings: {
            grid: {
              rows: [{ id: 'row-1', label: 'Reuniões' }],
              columns: [{ id: 'mon', label: 'Segunda' }, { id: 'fri', label: 'Sexta' }],
            },
          },
        },
        {
          id: 'scheduling',
          type: 'scheduling',
          title: 'Atendimento',
          required: true,
          options: [],
          settings: {
            scheduling: {
              hostName: 'Comissão eleitoral',
              location: 'Sala do CACiC',
              timezone: 'America/Sao_Paulo',
              durationMinutes: 30,
              slotIntervalMinutes: 30,
              bufferBeforeMinutes: 0,
              bufferAfterMinutes: 0,
              inviteeMode: 'optional',
              maxInvitees: 2,
              availability: [
                {
                  id: 'availability-1',
                  date: '2026-06-24',
                  startTime: '09:00',
                  endTime: '10:00',
                },
              ],
            },
          },
        },
      ],
    };

    component.setNumberAnswer('scale', 4);
    component.setSingleGridAnswer('single-grid', 'row-1', 'high');
    component.toggleMultipleGridAnswer('multiple-grid', 'row-1', 'mon', { checked: true });
    component.setSchedulingSlot('scheduling', 'availability-1:09:00');
    const nameInput = document.createElement('input');
    nameInput.value = 'Ana Souza';
    component.setSchedulingInvitee('scheduling', 0, 'name', { target: nameInput } as unknown as Event);

    await component.submit(extendedPoll);

    expect(api.submitResponse).toHaveBeenCalledWith('poll-1', {
      answers: [
        { elementId: 'scale', value: 4 },
        { elementId: 'single-grid', value: { 'row-1': 'high' } },
        { elementId: 'multiple-grid', value: { 'row-1': ['mon'] } },
        { elementId: 'scheduling', value: { slotId: 'availability-1:09:00', invitees: [{ name: 'Ana Souza' }] } },
      ],
    });
  });

  it('should update answer state for choice controls and expose selected values', () => {
    const component = fixture.componentInstance as unknown as {
      setSingleAnswer(elementId: string, event: { value: string }): void;
      setDropdownAnswer(elementId: string, event: { value: string }): void;
      toggleMultipleAnswer(elementId: string, optionId: string, event: { checked: boolean }): void;
      textAnswerValue(elementId: string): string;
      singleAnswerValue(elementId: string): string;
      isSingleAnswerSelected(elementId: string, optionId: string): boolean;
      isMultipleAnswerSelected(elementId: string, optionId: string): boolean;
    };

    component.setSingleAnswer('single', { value: 'yes' });
    component.setDropdownAnswer('dropdown', { value: 'morning' });
    component.toggleMultipleAnswer('multi', 'a', { checked: true });
    component.toggleMultipleAnswer('multi', 'b', { checked: true });
    component.toggleMultipleAnswer('multi', 'a', { checked: false });

    expect(component.singleAnswerValue('single')).toBe('yes');
    expect(component.singleAnswerValue('dropdown')).toBe('morning');
    expect(component.textAnswerValue('single')).toBe('yes');
    expect(component.isSingleAnswerSelected('single', 'yes')).toBe(true);
    expect(component.isMultipleAnswerSelected('multi', 'a')).toBe(false);
    expect(component.isMultipleAnswerSelected('multi', 'b')).toBe(true);
  });

  it('should expose number, grid, and scheduling helper state', () => {
    const component = fixture.componentInstance as unknown as {
      setNumberAnswer(elementId: string, value: number): void;
      isNumberAnswerSelected(elementId: string, value: number): boolean;
      isRatingFilled(elementId: string, value: number): boolean;
      setSingleGridAnswer(elementId: string, rowId: string, columnId: string): void;
      toggleMultipleGridAnswer(elementId: string, rowId: string, columnId: string, event: { checked: boolean }): void;
      isSingleGridColumnSelected(elementId: string, rowId: string, columnId: string): boolean;
      isMultipleGridColumnSelected(elementId: string, rowId: string, columnId: string): boolean;
      gridTemplateColumns(element: PollElement): string;
      linearScaleValues(element: PollElement): number[];
      starRatingValues(element: PollElement): number[];
    };
    const gridElement: PollElement = {
      id: 'grid',
      type: 'singleSelectionGrid',
      title: 'Grade',
      required: true,
      options: [],
      settings: {
        grid: {
          rows: [{ id: 'row-1', label: 'Linha' }],
          columns: [{ id: 'col-1', label: 'Coluna' }, { id: 'col-2', label: 'Outra' }],
        },
      },
    };

    component.setNumberAnswer('rating', 4);
    component.setSingleGridAnswer('single-grid', 'row-1', 'col-1');
    component.toggleMultipleGridAnswer('multi-grid', 'row-1', 'col-2', { checked: true });
    component.toggleMultipleGridAnswer('multi-grid', 'row-1', 'col-2', { checked: false });

    expect(component.isNumberAnswerSelected('rating', 4)).toBe(true);
    expect(component.isRatingFilled('rating', 3)).toBe(true);
    expect(component.isRatingFilled('rating', 5)).toBe(false);
    expect(component.isSingleGridColumnSelected('single-grid', 'row-1', 'col-1')).toBe(true);
    expect(component.isMultipleGridColumnSelected('multi-grid', 'row-1', 'col-2')).toBe(false);
    expect(component.gridTemplateColumns(gridElement)).toBe('minmax(10rem, 1.2fr) repeat(2, minmax(7rem, 1fr))');
    expect(
      component.linearScaleValues({
        ...gridElement,
        type: 'linearScale',
        settings: { linearScale: { min: 0, max: 3 } },
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(component.starRatingValues({ ...gridElement, type: 'starRating', settings: { starRating: { max: 3 } } })).toEqual([
      1,
      2,
      3,
    ]);
  });

  it('should build scheduling slots and invitee values', () => {
    const component = fixture.componentInstance as unknown as {
      schedulingSlots(element: PollElement): { id: string; label: string; meta: string }[];
      schedulingSlotGroups(element: PollElement): { date: string; label: string; slots: unknown[] }[];
      setSchedulingSlot(elementId: string, slotId: string): void;
      isSchedulingSlotSelected(elementId: string, slotId: string): boolean;
      schedulingInviteeIndexes(element: PollElement): number[];
      setSchedulingInvitee(elementId: string, index: number, field: 'name' | 'email', event: Event): void;
      schedulingInviteeValue(elementId: string, index: number, field: 'name' | 'email'): string;
      schedulingInviteeLabel(settings: NonNullable<PollElement['settings']>['scheduling']): string;
    };
    const schedulingElement: PollElement = {
      id: 'schedule',
      type: 'scheduling',
      title: 'Agenda',
      required: true,
      options: [],
      settings: {
        scheduling: {
          hostName: 'Comissão',
          location: 'Sala',
          timezone: 'America/Sao_Paulo',
          durationMinutes: 30,
          slotIntervalMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          inviteeMode: 'required',
          maxInvitees: 2,
          availability: [{ id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '10:00' }],
        },
      },
    };

    const slots = component.schedulingSlots(schedulingElement);
    component.setSchedulingSlot('schedule', slots[0].id);
    const input = document.createElement('input');
    input.value = 'ana@unesp.br';
    component.setSchedulingInvitee('schedule', 0, 'email', { target: input } as unknown as Event);

    expect(slots).toHaveLength(2);
    expect(slots[0].label).toContain('09:00 - 09:30');
    expect(slots[0].meta).toBe('30 min');
    expect(component.schedulingSlotGroups(schedulingElement)[0]).toMatchObject({
      date: '2026-06-24',
      slots,
    });
    expect(component.isSchedulingSlotSelected('schedule', 'window-1:09:00')).toBe(true);
    expect(component.schedulingInviteeIndexes(schedulingElement)).toEqual([0, 1]);
    expect(component.schedulingInviteeValue('schedule', 0, 'email')).toBe('ana@unesp.br');
    expect(component.schedulingInviteeLabel(schedulingElement.settings?.scheduling)).toBe('Convidados obrigatórios');
  });

  it('should build public result summaries for option, text, grid, and scheduling answers', () => {
    const component = fixture.componentInstance as unknown as {
      poll: { set(value: Poll): void };
      results: { set(value: PollResults): void };
      publicQuestionSummaries: () => {
        element: PollElement;
        answeredCount: number;
        buckets: { label: string; count: number }[];
        textAnswers: string[];
      }[];
      resultBucketPercent(
        summary: { answeredCount: number },
        bucket: { count: number },
      ): number;
    };
    const resultPoll: Poll = {
      ...poll,
      elements: [
        {
          id: 'choice',
          type: 'multipleChoice',
          title: 'Escolhas',
          required: true,
          options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        },
        { id: 'text', type: 'shortText', title: 'Texto', required: false, options: [] },
        {
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
      ],
    };

    component.poll.set(resultPoll);
    component.results.set({
      pollId: resultPoll.id,
      anonymous: false,
      responseCount: 2,
      responses: [
        {
          id: 'response-1',
          submittedAt: '2026-06-16T10:00:00.000Z',
          answers: [
            { elementId: 'choice', value: ['a', 'b'] },
            { elementId: 'text', value: 'Comentário' },
            { elementId: 'grid', value: { row: ['col'] } },
            { elementId: 'schedule', value: { slotId: 'window:09:00' } },
          ],
        },
        {
          id: 'response-2',
          submittedAt: '2026-06-16T10:05:00.000Z',
          answers: [{ elementId: 'choice', value: ['a'] }],
        },
      ],
    });

    const summaries = component.publicQuestionSummaries();

    expect(summaries[0]).toMatchObject({
      answeredCount: 2,
      buckets: [{ label: 'A', count: 2 }, { label: 'B', count: 1 }],
    });
    expect(summaries[1].textAnswers).toEqual(['Comentário']);
    expect(summaries[2].buckets).toEqual([{ label: 'Linha: Coluna', count: 1 }]);
    expect(summaries[3].buckets[0].label).toContain('09:00 - 09:30');
    expect(component.resultBucketPercent(summaries[0], summaries[0].buckets[1])).toBe(50);
    expect(component.resultBucketPercent({ answeredCount: 0 }, { count: 1 })).toBe(0);
  });

  it('should expose localized submit errors', async () => {
    const component = fixture.componentInstance as unknown as {
      error: { (): string | null };
      poll: { set(value: Poll): void };
      submit(poll: Poll): Promise<void>;
    };

    component.poll.set({ ...poll, voterEligibilitySource: 'enrollmentList' });
    vi.mocked(api.submitResponse).mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );
    await component.submit({ ...poll, voterEligibilitySource: 'enrollmentList' });
    expect(component.error()).toBe('Esta votação está disponível apenas para matrículas cadastradas na lista de habilitados.');

    vi.mocked(api.submitResponse).mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, statusText: 'Conflict' })),
    );
    await component.submit(poll);
    expect(component.error()).toBe('Sua resposta já foi registrada nesta votação.');
  });

  it('should compute vote availability and submit labels from response state', () => {
    const component = fixture.componentInstance as unknown as {
      poll: { set(value: Poll): void };
      responseState: { set(value: { hasSubmitted: boolean; canEdit: boolean; canSubmitAnother: boolean; response?: PollResponse }): void };
      loadingResponseState: { set(value: boolean): void };
      canVote: () => boolean;
      submitButtonLabel: () => string;
    };

    component.poll.set({ ...poll, status: 'draft' });
    expect(component.canVote()).toBe(false);

    component.poll.set(poll);
    component.loadingResponseState.set(false);
    component.responseState.set({ hasSubmitted: false, canEdit: false, canSubmitAnother: false });
    expect(component.canVote()).toBe(true);
    expect(component.submitButtonLabel()).toBe('Enviar voto');

    component.responseState.set({ hasSubmitted: true, canEdit: false, canSubmitAnother: true });
    expect(component.canVote()).toBe(true);
    expect(component.submitButtonLabel()).toBe('Enviar nova resposta');

    component.responseState.set({ hasSubmitted: true, canEdit: true, canSubmitAnother: false, response });
    expect(component.canVote()).toBe(true);
    expect(component.submitButtonLabel()).toBe('Salvar edição');
  });

  it('should load public results, open live events, and merge result deltas', async () => {
    const eventSource = { close: vi.fn(), onmessage: undefined as ((event: MessageEvent<string>) => void) | undefined };
    const component = fixture.componentInstance as unknown as {
      results: { (): PollResults | null };
      resultsError: { (): string | null };
      loadingResults: { (): boolean };
      loadPublicResults(poll: Poll): Promise<void>;
      ngOnDestroy(): void;
    };
    const initialResults: PollResults = {
      pollId: poll.id,
      anonymous: false,
      responseCount: 1,
      responses: [{ id: 'response-1', submittedAt: '2026-06-16T10:00:00.000Z', answers: [] }],
    };
    const delta = {
      pollId: poll.id,
      responseCount: 2,
      responses: [{ id: 'response-2', submittedAt: '2026-06-16T10:05:00.000Z', answers: [] }],
    };
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(of(initialResults));
    vi.mocked(api.openPublicPollResultsEvents).mockReturnValueOnce(eventSource as unknown as EventSource);
    vi.mocked(api.parseResultsDelta).mockReturnValueOnce(delta);

    await component.loadPublicResults({ ...poll, resultsPublic: true, resultsLive: true });
    eventSource.onmessage?.({ data: JSON.stringify(delta) } as MessageEvent<string>);

    expect(api.getPublicPollResults).toHaveBeenCalledWith(poll.id);
    expect(api.openPublicPollResultsEvents).toHaveBeenCalledWith(poll.id, 0);
    expect(component.results()?.responseCount).toBe(2);
    expect(component.results()?.responses.map((item) => item.id)).toEqual(['response-1', 'response-2']);
    expect(component.resultsError()).toBeNull();
    expect(component.loadingResults()).toBe(false);

    component.ngOnDestroy();
    expect(eventSource.close).toHaveBeenCalled();
  });

  it('should avoid opening public result events outside the browser', async () => {
    const component = fixture.componentInstance as unknown as {
      isBrowser: boolean;
      loadPublicResults(poll: Poll): Promise<void>;
    };
    component.isBrowser = false;
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(
      of({ pollId: poll.id, anonymous: false, responseCount: 0, responses: [] }),
    );

    await component.loadPublicResults({ ...poll, resultsPublic: true, resultsLive: true });

    expect(api.openPublicPollResultsEvents).not.toHaveBeenCalled();
  });

  it('should not load public results unless they are public and live or closed', async () => {
    const component = fixture.componentInstance as unknown as {
      results: { (): PollResults | null };
      loadPublicResults(poll: Poll): Promise<void>;
      shouldShowPublicResults(poll: Poll): boolean;
    };

    expect(component.shouldShowPublicResults({ ...poll, resultsPublic: false, resultsLive: true })).toBe(false);
    expect(component.shouldShowPublicResults({ ...poll, resultsPublic: true, resultsLive: false })).toBe(false);
    expect(component.shouldShowPublicResults({ ...poll, status: 'closed', resultsPublic: true, resultsLive: false })).toBe(true);

    await component.loadPublicResults({ ...poll, resultsPublic: false, resultsLive: true });

    expect(api.getPublicPollResults).not.toHaveBeenCalled();
    expect(component.results()).toBeNull();
  });

  it('should expose public result loading failures', async () => {
    const component = fixture.componentInstance as unknown as {
      resultsError: { (): string | null };
      loadingResults: { (): boolean };
      loadPublicResults(poll: Poll): Promise<void>;
    };
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(throwError(() => new Error('offline')));

    await component.loadPublicResults({ ...poll, status: 'closed', resultsPublic: true, resultsLive: false });

    expect(component.resultsError()).toBe('Não foi possível carregar os resultados públicos.');
    expect(component.loadingResults()).toBe(false);
  });

  it('should apply editable responses and localized submit success messages', async () => {
    const component = fixture.componentInstance as unknown as {
      responseState: { set(value: { hasSubmitted: boolean; canEdit: boolean; canSubmitAnother: boolean; response?: PollResponse }): void };
      answers: { (): Record<string, unknown> };
      loadUserResponseState(poll: Poll): Promise<void>;
      submit(poll: Poll): Promise<void>;
    };
    vi.mocked(api.getMyPollResponse).mockReturnValueOnce(
      of({ hasSubmitted: true, canEdit: true, canSubmitAnother: false, response }),
    );

    await component.loadUserResponseState(poll);
    expect(component.answers()).toEqual({ 'element-1': 'Maria' });

    component.responseState.set({ hasSubmitted: true, canEdit: true, canSubmitAnother: false, response });
    vi.mocked(api.submitResponse).mockReturnValueOnce(of(response));

    await component.submit({ ...poll, allowResponseEditing: true });

    expect(component.answers()).toEqual({ 'element-1': 'Maria' });
  });

  it('should cover remaining answer and denial helper branches', () => {
    const component = fixture.componentInstance as unknown as {
      readSingleGridAnswer(value: unknown): Record<string, string>;
      readMultipleGridAnswer(value: unknown): Record<string, string[]>;
      readSchedulingAnswer(value: unknown): { slotId: string; invitees: { name: string; email: string }[] };
      voterEligibilityDeniedMessage(source: unknown): string;
      formatDateLabel(value: string): string;
    };
    const element: PollElement = {
      id: 'choice',
      type: 'singleChoice',
      title: 'Escolha',
      required: true,
      options: [{ id: 'yes', label: 'Sim' }],
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

    expect(answerValueLabels(element, 3)).toEqual(['3']);
    expect(answerValueLabels(element, 'missing')).toEqual(['missing']);
    expect(answerValueLabels(element, null)).toEqual([]);
    expect(answerValueLabels({ ...element, type: 'date' }, { unexpected: true })).toEqual([]);
    expect(answerValueLabels(gridElement, { row: 1 })).toEqual([]);
    expect(component.readSingleGridAnswer({ row: 'col', invalid: 1 })).toEqual({ row: 'col' });
    expect(component.readSingleGridAnswer('invalid')).toEqual({});
    expect(component.readMultipleGridAnswer({ row: ['col', 1] })).toEqual({ row: ['col'] });
    expect(component.readMultipleGridAnswer('invalid')).toEqual({});
    expect(component.readSchedulingAnswer({ slotId: 1, invitees: [{ name: 2, email: 'x' }] })).toEqual({
      slotId: '',
      invitees: [{ name: '', email: 'x' }],
    });
    expect(component.formatDateLabel('sem-data')).toBe('sem-data');
    expect(component.voterEligibilityDeniedMessage('eventAttendance')).toContain('presença registrada');
    expect(component.voterEligibilityDeniedMessage('eventAttendanceUnespUsers')).toContain('unespianos');
    expect(component.voterEligibilityDeniedMessage('eventAttendanceComputerScienceStudents')).toContain('alunos da computação');
    expect(component.voterEligibilityDeniedMessage('unespUsers')).toContain('unespianos');
    expect(component.voterEligibilityDeniedMessage('computerScienceStudents')).toContain('alunos da computação');
    expect(component.voterEligibilityDeniedMessage('authenticatedUsers')).toBe('Você não está habilitado a votar nesta votação.');
  });

  it('should cover remaining public result and response-state edge branches', async () => {
    const component = fixture.componentInstance as unknown as {
      poll: { set(value: Poll | null): void };
      results: { set(value: PollResults | null): void; (): PollResults | null };
      responseState: { (): unknown };
      publicQuestionSummaries: () => unknown[];
      toggleMultipleAnswer(elementId: string, optionId: string, event: { checked: boolean }): void;
      schedulingSlots(element: PollElement): unknown[];
      schedulingInviteeIndexes(element: PollElement): number[];
      loadUserResponseState(poll: Poll): Promise<void>;
      applyResultsDelta(delta: { pollId: string; responseCount: number; responses: PollResults['responses'] }): void;
      submit(poll: Poll): Promise<void>;
    };
    const scheduleWithoutSettings: PollElement = {
      id: 'schedule',
      type: 'scheduling',
      title: 'Agenda',
      required: false,
      options: [],
    };

    component.poll.set(null);
    expect(component.publicQuestionSummaries()).toEqual([]);
    component.toggleMultipleAnswer('missing-array', 'a', { checked: false });
    expect(component.schedulingSlots(scheduleWithoutSettings)).toEqual([]);
    expect(component.schedulingInviteeIndexes(scheduleWithoutSettings)).toEqual([]);
    expect(component.schedulingInviteeIndexes({ ...scheduleWithoutSettings, settings: { scheduling: {
      hostName: '',
      location: '',
      timezone: 'America/Sao_Paulo',
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      inviteeMode: 'none',
      maxInvitees: 0,
      availability: [],
    } } })).toEqual([]);

    vi.mocked(api.getMyPollResponse).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.loadUserResponseState(poll);
    expect(component.responseState()).toMatchObject({ hasSubmitted: false });

    component.results.set({ pollId: poll.id, anonymous: false, responseCount: 1, responses: [] });
    component.applyResultsDelta({ pollId: 'other', responseCount: 2, responses: [] });
    expect(component.results()?.responseCount).toBe(1);

    vi.mocked(api.submitResponse).mockReturnValueOnce(of(response));
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(
      of({ pollId: poll.id, anonymous: false, responseCount: 1, responses: [] }),
    );
    component.results.set(null);
    await component.submit({ ...poll, resultsPublic: true, resultsLive: true });
    expect(api.getPublicPollResults).toHaveBeenCalledWith(poll.id);
  });

  it('should expose 401 and generic submit error messages', async () => {
    const component = fixture.componentInstance as unknown as {
      error: { (): string | null };
      submit(poll: Poll): Promise<void>;
    };

    vi.mocked(api.submitResponse).mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })),
    );
    await component.submit(poll);
    expect(component.error()).toBe('Entre para votar nesta votação.');

    vi.mocked(api.submitResponse).mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.submit(poll);
    expect(component.error()).toBe('Não foi possível registrar sua resposta. Confira os campos obrigatórios.');
  });

  it('should expose load errors when the route id is missing or the poll request fails', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PollVotePageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: vi.fn().mockReturnValue(null),
              },
            },
          },
        },
      ],
    }).compileComponents();
    const missingFixture = TestBed.createComponent(PollVotePageComponent);
    missingFixture.detectChanges();
    await missingFixture.whenStable();
    expect((missingFixture.componentInstance as unknown as { error: { (): string | null } }).error()).toBe(
      'Votação não encontrada.',
    );

    TestBed.resetTestingModule();
    const failingApi = {
      ...api,
      getPublicPoll: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
    };
    await TestBed.configureTestingModule({
      imports: [PollVotePageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: failingApi },
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: vi.fn().mockReturnValue('poll-1'),
              },
            },
          },
        },
      ],
    }).compileComponents();
    const failingFixture = TestBed.createComponent(PollVotePageComponent);
    failingFixture.detectChanges();
    await failingFixture.whenStable();

    expect((failingFixture.componentInstance as unknown as { error: { (): string | null } }).error()).toBe(
      'Não foi possível carregar a votação.',
    );
  });
});
