import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminCacicElectionSlate,
  CacicElectionSlate,
  Poll,
  PollKioskVoter,
  PollResults,
  PollUserResponseState,
} from '@org/voting-contracts';
import { PollApiService } from './poll-api.service';
import { AnswerMap } from './poll-vote-answer-state';
import { resolvePollAccess } from './poll-vote-access';
import {
  canSubmitSlateInPoll,
  canVoteInPoll,
  emptyResponseState,
  votingUnavailableTitle,
} from './poll-vote-availability';
import {
  PollMetadataRuleItem,
  PollMetadataSummaryItem,
  buildPollMetadataRuleItems,
  buildPollMetadataSummaryItems,
} from './poll-vote-metadata';
import { buildPublicQuestionSummaries } from './poll-public-results';
import { of } from 'rxjs';
import { PollResultsFinalizationState } from './poll-results-reconciliation';

export abstract class PollVotePageState {
  protected readonly api = inject(PollApiService);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly snackBar = inject(MatSnackBar);
  private readonly routeParamMap = toSignal(
    this.route.paramMap ?? of(this.route.snapshot.paramMap),
    { initialValue: this.route.snapshot.paramMap },
  );
  protected readonly pollAccess = computed(() => resolvePollAccess(this.routeParamMap()));
  protected readonly isKioskMode = this.route.snapshot.data?.['mode'] === 'kiosk';
  protected readonly kioskVoter = signal<PollKioskVoter | null>(null);

  protected readonly poll = signal<Poll | null>(null);
  protected readonly answers = signal<AnswerMap>({});
  protected readonly results = signal<PollResults | null>(null);
  protected readonly slates = signal<CacicElectionSlate[]>([]);
  protected readonly mySlate = signal<AdminCacicElectionSlate | null>(null);
  protected readonly responseState =
    signal<PollUserResponseState>(emptyResponseState);
  protected readonly responseStateError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingResults = signal(false);
  protected readonly loadingSlates = signal(false);
  protected readonly loadingResponseState = signal(false);
  protected readonly saving = signal(false);
  protected readonly savingSlate = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly resultsError = signal<string | null>(null);
  protected readonly resultsFinalizationState = signal<PollResultsFinalizationState>('idle');
  protected readonly resultsFinalizationError = signal<string | null>(null);
  protected readonly pendingFinalResultsPollId = signal<string | null>(null);
  protected readonly resultsConnectionState = signal<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  protected resultsEvents?: EventSource;

  protected pollLoadGeneration = 0;
  private readonly clockNow = signal(Date.now());
  private clockBoundaryTimer?: ReturnType<typeof setTimeout>;
  private readonly clockVisibilityListener = (): void => {
    if (this.isBrowser && document.visibilityState === 'visible') {
      this.refreshPollClock();
    }
  };

  constructor() {
    if (this.isBrowser) {
      document.addEventListener('visibilitychange', this.clockVisibilityListener);
    }

    effect(() => {
      const poll = this.poll();
      // The poll request can complete after one of its time boundaries. Update
      // the derived clock before deciding whether another boundary is pending.
      this.clockNow.set(Date.now());
      this.scheduleClockBoundary(poll);
    });
  }

  protected readonly metadataSummaryItems = computed<PollMetadataSummaryItem[]>(
    () => {
      const poll = this.poll();
      return poll ? buildPollMetadataSummaryItems(poll) : [];
    },
  );
  protected readonly metadataRuleItems = computed<PollMetadataRuleItem[]>(
    () => {
      const poll = this.poll();
      return poll ? buildPollMetadataRuleItems(poll) : [];
    },
  );
  protected readonly canVote = computed(() => {
    const now = new Date(this.clockNow());
    return canVoteInPoll(
      this.poll(),
      this.responseState(),
      this.loadingResponseState(),
      this.responseStateError(),
      now,
    );
  });
  protected readonly canSubmitSlate = computed(() => {
    return canSubmitSlateInPoll(this.poll(), new Date(this.clockNow()));
  });
  protected readonly votingUnavailableTitle = computed(() => {
    return votingUnavailableTitle(this.poll(), new Date(this.clockNow()));
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
    const aggregates = this.results()?.aggregates ?? [];
    if (!poll) {
      return [];
    }

    return buildPublicQuestionSummaries(poll.elements, responses, aggregates);
  });

  protected beginPollLoad(): number {
    this.pollLoadGeneration += 1;
    return this.pollLoadGeneration;
  }

  protected invalidatePollLoad(): void {
    this.pollLoadGeneration += 1;
  }

  protected isPollLoadCurrent(generation: number): boolean {
    return generation === this.pollLoadGeneration;
  }

  protected refreshPollClock(): void {
    this.clockNow.set(Date.now());
    this.scheduleClockBoundary(this.poll());
  }

  protected destroyPollState(): void {
    this.invalidatePollLoad();
    if (this.clockBoundaryTimer) {
      clearTimeout(this.clockBoundaryTimer);
      this.clockBoundaryTimer = undefined;
    }
    if (this.isBrowser) {
      document.removeEventListener('visibilitychange', this.clockVisibilityListener);
    }
  }

  private scheduleClockBoundary(poll: Poll | null): void {
    if (this.clockBoundaryTimer) {
      clearTimeout(this.clockBoundaryTimer);
      this.clockBoundaryTimer = undefined;
    }

    if (!this.isBrowser || !poll) {
      return;
    }

    const now = Date.now();
    const boundary = [poll.visibleFrom, poll.votingStartsAt, poll.votingEndsAt]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .filter((value): value is number => Number.isFinite(value) && value > now)
      .sort((left, right) => left - right)[0];
    if (boundary === undefined) {
      return;
    }

    const delay = Math.min(Math.max(boundary - now, 0), 2_147_000_000);
    this.clockBoundaryTimer = setTimeout(() => {
      this.clockBoundaryTimer = undefined;
      this.clockNow.set(Date.now());
      this.scheduleClockBoundary(this.poll());
    }, delay);
  }
}
