import {
  Poll,
  PollResultsDelta,
  PollVoterEligibilitySource,
} from '@org/voting-contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  PublicQuestionResultSummary,
  PublicResultBucket,
  resultBucketPercent as calculateResultBucketPercent,
  shouldShowPublicResults as canShowPublicResults,
} from './poll-public-results';
import { formatDateLabel as formatPublicResultDateLabel } from './poll-result-formatting';
import { pollResultsLink } from './poll-vote-access';
import { isPollVotingOpen, readInstantTime } from './poll-vote-availability';
import { voterEligibilityDeniedMessage as buildVoterEligibilityDeniedMessage } from './poll-vote-metadata';
import { PollVotePageResponse } from './poll-vote-page-response';
import { applyResultsDelta as applyResultsDeltaToResults } from './poll-vote-results-state';
import { reconcilePollResults } from './poll-results-reconciliation';

export abstract class PollVotePageResults extends PollVotePageResponse {
  private resultsRefreshTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private resultsRequestRevision = 0;

  protected async loadPublicResults(poll: Poll): Promise<void> {
    const generation = this.pollLoadGeneration;
    if (!this.isPollLoadCurrent(generation)) {
      return;
    }
    this.resultsRequestRevision += 1;
    this.closeResultsEvents();
    this.results.set(null);
    this.resultsError.set(null);
    this.resultsFinalizationState.set('idle');
    this.resultsFinalizationError.set(null);
    this.pendingFinalResultsPollId.set(null);

    if (!this.shouldShowPublicResults(poll)) {
      return;
    }

    this.loadingResults.set(true);
    try {
      const results = await firstValueFrom(this.getPublicPollResults(poll.id));
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      this.results.set(results);
      if (poll.status === 'published' && poll.resultsLive && poll.votingStyle === 'public') {
        this.openPublicResultsEvents(poll.id, generation);
      }
    } catch (error: unknown) {
      if (this.isPollLoadCurrent(generation)) {
        this.resultsError.set(this.resultsLoadErrorMessage(error));
      }
    } finally {
      if (this.isPollLoadCurrent(generation)) {
        this.loadingResults.set(false);
      }
    }
  }

  protected closeResultsEvents(): void {
    if (this.resultsRefreshTimer) {
      clearTimeout(this.resultsRefreshTimer);
      this.resultsRefreshTimer = undefined;
    }
    this.resultsEvents?.close();
    this.resultsEvents = undefined;
  }

  protected shouldShowPublicResults(poll: Poll): boolean {
    return !this.isKioskMode && canShowPublicResults(poll);
  }

  protected resultsLink(poll: Poll): unknown[] {
    const access = this.pollAccess();
    return access
      ? pollResultsLink(access, poll.id)
      : ['/polls', poll.id, 'results'];
  }

  protected resultBucketPercent(
    summary: PublicQuestionResultSummary,
    bucket: PublicResultBucket,
  ): number {
    return calculateResultBucketPercent(summary, bucket);
  }

  protected retryFinalResults(): void {
    const pollId = this.pendingFinalResultsPollId();
    const poll = this.poll();
    if (!pollId || !poll || poll.id !== pollId) {
      return;
    }

    this.resultsFinalizationState.set('pending');
    this.resultsFinalizationError.set(null);
    void this.reconcileFinalResults(pollId, this.pollLoadGeneration);
  }

  private getPublicPollResults(pollId: string) {
    const access = this.pollAccess();
    return access?.kind === 'directLink'
      ? this.api.getDirectLinkPollResults(access.value)
      : this.api.getPublicPollResults(pollId);
  }

  private openPublicResultsEvents(pollId: string, generation: number): void {
    if (!this.isBrowser) {
      return;
    }

    const access = this.pollAccess();
    const source =
      access?.kind === 'directLink'
        ? this.api.openDirectLinkPollResultsEvents(access.value)
        : this.api.openPublicPollResultsEvents(pollId);
    source.onmessage = (event) => {
      if (!this.isPollLoadCurrent(generation)) {
        source.close();
        return;
      }
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
        if (delta.final) {
          this.resultsRequestRevision += 1;
          this.pendingFinalResultsPollId.set(pollId);
          this.resultsFinalizationState.set('pending');
          this.resultsFinalizationError.set(null);
          void this.reconcileFinalResults(pollId, generation);
        } else if (delta.refreshRequired) {
          this.scheduleResultsRefresh(pollId, generation);
        }
      }
    };
    source.onopen = () => {
      if (!this.isPollLoadCurrent(generation)) {
        source.close();
        return;
      }
      this.reconnectAttempts = 0;
      this.resultsConnectionState.set('connected');
    };
    source.onerror = () => {
      if (!this.isPollLoadCurrent(generation)) {
        source.close();
        return;
      }
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts >= 5) {
        source.close();
        this.resultsConnectionState.set('closed');
        return;
      }
      this.resultsConnectionState.set(
        typeof EventSource !== 'undefined' && source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
      );
    };
    this.resultsConnectionState.set('connecting');
    this.resultsEvents = source;
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => applyResultsDeltaToResults(current, delta));
  }

  private async reconcileFinalResults(pollId: string, generation: number): Promise<void> {
    await reconcilePollResults(
      () => firstValueFrom(this.getPublicPollResults(pollId)),
      {
        isCurrent: () => this.isPollLoadCurrent(generation),
        apply: (results) => {
          this.results.set(results);
          this.resultsFinalizationState.set('complete');
          this.resultsFinalizationError.set(null);
          this.closeResultsEvents();
        },
        fail: () => {
          this.resultsFinalizationState.set('failed');
          this.resultsFinalizationError.set(
            'Os resultados finais ainda não estão disponíveis. Tente novamente.',
          );
        },
      },
    );
  }

  private scheduleResultsRefresh(pollId: string, generation: number): void {
    if (this.resultsRefreshTimer) {
      return;
    }

    this.resultsRefreshTimer = setTimeout(() => {
      this.resultsRefreshTimer = undefined;
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      const requestRevision = this.resultsRequestRevision;
      void firstValueFrom(this.getPublicPollResults(pollId))
        .then((results) => {
          if (this.isPollLoadCurrent(generation) && requestRevision === this.resultsRequestRevision) {
            this.results.set(results);
          }
        })
        .catch(() => {
          if (this.isPollLoadCurrent(generation)) {
            this.resultsError.set('A atualização dos resultados está temporariamente indisponível.');
          }
        });
    }, 250);
  }

  private resultsLoadErrorMessage(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
      case 401:
        return 'Sua sessão expirou. Entre novamente para consultar os resultados.';
      case 403:
        return 'Os resultados não estão disponíveis para este acesso.';
      case 404:
        return 'Votação não encontrada.';
      case 409:
        return 'A votação mudou. Atualize a página e tente novamente.';
      case 503:
        return 'O serviço de resultados está temporariamente indisponível. Tente novamente em instantes.';
      default:
        return 'Não foi possível carregar os resultados públicos. Verifique sua conexão e tente novamente.';
    }
  }

  private isPollVotingOpen(poll: Poll): boolean {
    return isPollVotingOpen(poll);
  }

  private readInstantTime(
    value: string | null | undefined,
    fallback = Number.NEGATIVE_INFINITY,
  ): number {
    return readInstantTime(value, fallback);
  }

  private voterEligibilityDeniedMessage(
    source: PollVoterEligibilitySource | undefined,
  ): string {
    return buildVoterEligibilityDeniedMessage(source);
  }

  private formatDateLabel(value: string): string {
    return formatPublicResultDateLabel(value);
  }
}
