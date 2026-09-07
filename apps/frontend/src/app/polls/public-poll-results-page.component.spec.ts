import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { Poll, PollResults } from '@org/voting-contracts';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PollApiService } from './poll-api.service';
import { PublicPollResultsPageComponent } from './public-poll-results-page.component';

async function renderAsync(
  fixture: ComponentFixture<PublicPollResultsPageComponent>,
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise<void>((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('PublicPollResultsPageComponent', () => {
  let fixture: ComponentFixture<PublicPollResultsPageComponent>;
  let api: Pick<
    PollApiService,
    | 'getPublicPoll'
    | 'getDirectLinkPoll'
    | 'getPublicPollResults'
    | 'getDirectLinkPollResults'
    | 'openPublicPollResultsEvents'
    | 'openDirectLinkPollResultsEvents'
    | 'parseResultsDelta'
  >;

  const poll: Poll = {
    id: 'poll-1',
    title: 'Consulta pública',
    description: 'Escolha uma opção.',
    status: 'published',
    mode: 'regular',
    votingStyle: 'public',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: true,
    resultsLive: true,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    publishedAt: '2026-06-01T10:00:00.000Z',
    elements: [
      {
        id: 'choice',
        type: 'singleChoice',
        title: 'Prioridade',
        required: true,
        options: [
          { id: 'a', label: 'Infraestrutura' },
          { id: 'b', label: 'Eventos' },
        ],
      },
      {
        id: 'text',
        type: 'shortText',
        title: 'Comentário',
        required: false,
        options: [],
      },
    ],
  };

  const results: PollResults = {
    pollId: poll.id,
    anonymous: false,
    answersReleased: true,
    responseCount: 1,
    voterCount: 1,
    voters: [
      {
        userId: 'user-1',
        name: 'Ada Lovelace',
        preferredUsername: 'ada',
        email: 'ada@unesp.br',
      },
    ],
    responses: [
      {
        id: 'response-1',
        submittedAt: '2026-06-16T10:00:00.000Z',
        voter: {
          userId: 'user-1',
          name: 'Ada Lovelace',
          preferredUsername: 'ada',
          email: 'ada@unesp.br',
        },
        answers: [
          { elementId: 'choice', value: 'a' },
          { elementId: 'text', value: 'Comentário público' },
        ],
      },
    ],
  };

  beforeEach(async () => {
    api = {
      getPublicPoll: vi.fn().mockReturnValue(of(poll)),
      getDirectLinkPoll: vi.fn().mockReturnValue(of(poll)),
      getPublicPollResults: vi.fn().mockReturnValue(of(results)),
      getDirectLinkPollResults: vi.fn().mockReturnValue(of(results)),
      openPublicPollResultsEvents: vi.fn().mockReturnValue({ close: vi.fn() } as unknown as EventSource),
      openDirectLinkPollResultsEvents: vi.fn().mockReturnValue({ close: vi.fn() } as unknown as EventSource),
      parseResultsDelta: vi.fn().mockReturnValue(null),
    };

    await TestBed.configureTestingModule({
      imports: [PublicPollResultsPageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: api },
        { provide: PLATFORM_ID, useValue: 'browser' },
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

    fixture = TestBed.createComponent(PublicPollResultsPageComponent);
    await renderAsync(fixture);
  });

  it('should load poll results and render public details', () => {
    expect(api.getPublicPoll).toHaveBeenCalledWith('poll-1');
    expect(api.getPublicPollResults).toHaveBeenCalledWith('poll-1');
    expect(api.openPublicPollResultsEvents).toHaveBeenCalledWith('poll-1');
    expect(fixture.nativeElement.textContent).toContain('Resultados de Consulta pública');
    expect(fixture.nativeElement.textContent).toContain('1 pessoa votou.');
    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
    expect(fixture.nativeElement.textContent).toContain('Comentário público');
  });

  it('renders individual answers from their historical element snapshots', () => {
    const component = fixture.componentInstance as unknown as {
      responseAnswerRows(response: PollResults['responses'][number]): { question: string; value: string }[];
    };
    const historicalChoice = {
      ...poll.elements[0],
      title: 'Prioridade no envio',
      options: [{ id: 'a', label: 'Infraestrutura original' }, { id: 'b', label: 'Eventos' }],
    };
    const retiredElement = {
      id: 'retired',
      type: 'singleChoice' as const,
      title: 'Pergunta removida',
      required: false,
      options: [{ id: 'yes', label: 'Sim na época' }],
    };
    const response = {
      ...results.responses[0],
      answers: [
        { elementId: 'choice', value: 'a', element: historicalChoice },
        { elementId: 'retired', value: 'yes', element: retiredElement },
      ],
    };

    expect(component.responseAnswerRows(response)).toEqual([
      { question: 'Prioridade no envio', value: 'Infraestrutura original' },
      { question: 'Pergunta removida', value: 'Sim na época' },
    ]);
  });

  it('keeps final reconciliation recoverable after a transient results failure', async () => {
    const component = fixture.componentInstance as unknown as {
      pendingFinalResultsPollId: { set(value: string | null): void };
      resultsFinalizationState: { (): string };
      resultsFinalizationError: { (): string | null };
      reconcileFinalResults(pollId: string, generation: number): Promise<void>;
      retryFinalResults(): void;
    };
    component.pendingFinalResultsPollId.set(poll.id);
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(throwError(() => new Error('temporary outage')));

    await component.reconcileFinalResults(poll.id, 1);

    expect(component.resultsFinalizationState()).toBe('failed');
    expect(component.resultsFinalizationError()).toContain('resultados finais');

    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(of(results));
    component.retryFinalResults();
    await new Promise<void>((resolve) => setTimeout(resolve));

    expect(component.resultsFinalizationState()).toBe('complete');
  });

  it('should summarize answers and apply live result snapshots', () => {
    const eventSource = {
      close: vi.fn(),
      onmessage: undefined as ((event: MessageEvent<string>) => void) | undefined,
    };
    vi.mocked(api.openPublicPollResultsEvents).mockReturnValueOnce(eventSource as unknown as EventSource);
    vi.mocked(api.parseResultsDelta).mockReturnValueOnce({
      pollId: poll.id,
      responseCount: 2,
      responses: [
        results.responses[0],
        {
          id: 'response-2',
          answers: [{ elementId: 'choice', value: 'b' }],
        },
      ],
    });

    const component = fixture.componentInstance as unknown as {
      results: { (): PollResults | null };
      questionSummaries: () => { answeredCount: number; buckets: { label: string; count: number }[] }[];
      resultBucketPercent(summary: { answeredCount: number }, bucket: { count: number }): number;
      voteCountText(responseCount: number): string;
      ngOnDestroy(): void;
      openResultsEvents(pollId: string): void;
    };

    component.openResultsEvents(poll.id);
    eventSource.onmessage?.({ data: '{}' } as MessageEvent<string>);

    expect(component.results()?.responseCount).toBe(2);
    expect(component.questionSummaries()[0].buckets).toEqual([
      { label: 'Eventos', count: 1 },
      { label: 'Infraestrutura', count: 1 },
    ]);
    expect(component.resultBucketPercent({ answeredCount: 2 }, { count: 1 })).toBe(50);
    expect(component.resultBucketPercent({ answeredCount: 0 }, { count: 1 })).toBe(0);
    expect(component.voteCountText(2)).toBe('2 pessoas votaram.');

    component.ngOnDestroy();
    expect(eventSource.close).toHaveBeenCalled();
  });

  it('should show text answer summaries for secret voting style', async () => {
    TestBed.resetTestingModule();
    api.getPublicPoll = vi.fn().mockReturnValue(of({ ...poll, votingStyle: 'secret' }));

    await TestBed.configureTestingModule({
      imports: [PublicPollResultsPageComponent],
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

    const secretFixture = TestBed.createComponent(PublicPollResultsPageComponent);
    await renderAsync(secretFixture);

    expect(secretFixture.nativeElement.textContent).toContain('Comentário público');
    expect(secretFixture.nativeElement.textContent).not.toContain('Respostas individuais');
  });

  it('should support direct-link result routes', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PublicPollResultsPageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: vi.fn((name: string) =>
                  name === 'directLinkToken' ? 'direct-token' : null,
                ),
              },
            },
          },
        },
      ],
    }).compileComponents();

    const directFixture = TestBed.createComponent(PublicPollResultsPageComponent);
    await renderAsync(directFixture);

    expect(api.getDirectLinkPoll).toHaveBeenCalledWith('direct-token');
    expect(api.getDirectLinkPollResults).toHaveBeenCalledWith('direct-token');
  });

  it('should expose localized load errors', async () => {
    TestBed.resetTestingModule();
    api.getPublicPoll = vi.fn().mockReturnValue(throwError(() => new Error('offline')));

    await TestBed.configureTestingModule({
      imports: [PublicPollResultsPageComponent],
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

    const errorFixture = TestBed.createComponent(PublicPollResultsPageComponent);
    await renderAsync(errorFixture);

    expect(errorFixture.nativeElement.textContent).toContain(
      'Não foi possível carregar os resultados públicos desta votação.',
    );
  });

  it('reloads results and replaces the live stream when route parameters change', async () => {
    TestBed.resetTestingModule();
    const routeParams = new Subject<ParamMap>();
    const pollB = { ...poll, id: 'poll-2', title: 'Outra consulta', resultsLive: false };
    const resultsB = { ...results, pollId: pollB.id, responseCount: 7 };
    const dynamicApi = {
      ...api,
      getPublicPoll: vi.fn().mockImplementation((id: string) => of(id === pollB.id ? pollB : poll)),
      getPublicPollResults: vi.fn().mockImplementation((id: string) => of(id === pollB.id ? resultsB : results)),
      openPublicPollResultsEvents: vi.fn().mockReturnValue({ close: vi.fn() } as unknown as EventSource),
    };
    await TestBed.configureTestingModule({
      imports: [PublicPollResultsPageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: dynamicApi },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParams.asObservable(),
            snapshot: { paramMap: convertToParamMap({ id: poll.id }) },
          },
        },
      ],
    }).compileComponents();

    const dynamicFixture = TestBed.createComponent(PublicPollResultsPageComponent);
    await renderAsync(dynamicFixture);
    routeParams.next(convertToParamMap({ id: pollB.id }));
    await new Promise<void>((resolve) => setTimeout(resolve));
    await renderAsync(dynamicFixture);

    expect(dynamicApi.getPublicPoll).toHaveBeenCalledWith(pollB.id);
    expect(dynamicApi.getPublicPollResults).toHaveBeenCalledWith(pollB.id);
    expect(dynamicFixture.nativeElement.textContent).toContain(`Resultados de ${pollB.title}`);
    expect(dynamicFixture.nativeElement.textContent).not.toContain(`Resultados de ${poll.title}`);
    dynamicFixture.destroy();
  });

  it('does not apply a results response that resolves after destruction', async () => {
    const pendingResults = new Subject<PollResults>();
    const component = fixture.componentInstance as unknown as {
      results: { (): PollResults | null };
      reconcileFinalResults(pollId: string, generation: number): Promise<void>;
    };
    vi.mocked(api.getPublicPollResults).mockReturnValueOnce(pendingResults.asObservable());

    const reconciliation = component.reconcileFinalResults(poll.id, 1);
    fixture.destroy();
    pendingResults.next({ ...results, responseCount: 99 });
    pendingResults.complete();
    await reconciliation;

    expect(component.results()?.responseCount).toBe(results.responseCount);
  });

  it('does not let a pre-final refresh roll back a successful final result', async () => {
    vi.useFakeTimers();
    const pendingRefresh = new Subject<PollResults>();
    const source = {
      close: vi.fn(),
      onmessage: undefined as ((event: MessageEvent<string>) => void) | undefined,
    };
    const finalResults = { ...results, responseCount: 8 };
    vi.mocked(api.getPublicPollResults)
      .mockReturnValueOnce(pendingRefresh.asObservable())
      .mockReturnValueOnce(of(finalResults));
    vi.mocked(api.openPublicPollResultsEvents).mockReturnValueOnce(source as unknown as EventSource);
    vi.mocked(api.parseResultsDelta).mockReturnValueOnce({
      pollId: poll.id,
      final: true,
      responseCount: results.responseCount,
      responses: results.responses,
    });

    const component = fixture.componentInstance as unknown as {
      scheduleResultsRefresh(pollId: string, generation: number): void;
      openResultsEvents(pollId: string): void;
      results: { (): PollResults | null };
    };
    component.scheduleResultsRefresh(poll.id, 1);
    vi.advanceTimersByTime(250);
    component.openResultsEvents(poll.id);
    source.onmessage?.({ data: '{}' } as MessageEvent<string>);
    await Promise.resolve();
    await Promise.resolve();

    pendingRefresh.next({ ...results, responseCount: 2 });
    pendingRefresh.complete();
    await Promise.resolve();

    expect(component.results()?.responseCount).toBe(finalResults.responseCount);
    vi.useRealTimers();
  });
});
