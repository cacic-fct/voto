import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, inject, signal } from '@angular/core';
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
import {
  PublicPollAccess,
  resolvePollAccess,
} from './poll-vote-access';
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

export abstract class PollVotePageState {
  protected readonly api = inject(PollApiService);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly snackBar = inject(MatSnackBar);
  protected readonly pollAccess = this.resolvePollAccess();
  protected readonly isKioskMode = this.route.snapshot.data?.['mode'] === 'kiosk';
  protected readonly kioskVoter = signal<PollKioskVoter | null>(null);

  protected readonly poll = signal<Poll | null>(null);
  protected readonly answers = signal<AnswerMap>({});
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
  protected resultsEvents?: EventSource;

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
    return canVoteInPoll(
      this.poll(),
      this.responseState(),
      this.loadingResponseState(),
    );
  });
  protected readonly canSubmitSlate = computed(() => {
    return canSubmitSlateInPoll(this.poll());
  });
  protected readonly votingUnavailableTitle = computed(() => {
    return votingUnavailableTitle(this.poll());
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

    return buildPublicQuestionSummaries(poll.elements, responses);
  });

  private resolvePollAccess(): PublicPollAccess | null {
    return resolvePollAccess(this.route.snapshot.paramMap);
  }
}
