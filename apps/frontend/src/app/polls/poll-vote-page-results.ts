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

export abstract class PollVotePageResults extends PollVotePageResponse {
  private resultsRefreshTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;

  protected async loadPublicResults(poll: Poll): Promise<void> {
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
      if (poll.status === 'published' && poll.resultsLive && poll.votingStyle === 'public') {
        this.openPublicResultsEvents(poll.id);
      }
    } catch (error: unknown) {
      this.resultsError.set(this.resultsLoadErrorMessage(error));
    } finally {
      this.loadingResults.set(false);
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
    return this.pollAccess
      ? pollResultsLink(this.pollAccess, poll.id)
      : ['/polls', poll.id, 'results'];
  }

  protected resultBucketPercent(
    summary: PublicQuestionResultSummary,
    bucket: PublicResultBucket,
  ): number {
    return calculateResultBucketPercent(summary, bucket);
  }

  private getPublicPollResults(pollId: string) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.getDirectLinkPollResults(this.pollAccess.value)
      : this.api.getPublicPollResults(pollId);
  }

  private openPublicResultsEvents(pollId: string): void {
    if (!this.isBrowser) {
      return;
    }

    const source =
      this.pollAccess?.kind === 'directLink'
        ? this.api.openDirectLinkPollResultsEvents(this.pollAccess.value)
        : this.api.openPublicPollResultsEvents(pollId);
    source.onmessage = (event) => {
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
        if (delta.final) {
          void this.reconcileFinalResults(pollId);
        } else if (delta.refreshRequired) {
          this.scheduleResultsRefresh(pollId);
        }
      }
    };
    source.onopen = () => {
      this.reconnectAttempts = 0;
      this.resultsConnectionState.set('connected');
    };
    source.onerror = () => {
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

  private async reconcileFinalResults(pollId: string): Promise<void> {
    try {
      this.results.set(await firstValueFrom(this.getPublicPollResults(pollId)));
    } finally {
      this.closeResultsEvents();
    }
  }

  private scheduleResultsRefresh(pollId: string): void {
    if (this.resultsRefreshTimer) {
      return;
    }

    this.resultsRefreshTimer = setTimeout(() => {
      this.resultsRefreshTimer = undefined;
      void firstValueFrom(this.getPublicPollResults(pollId))
        .then((results) => this.results.set(results))
        .catch(() => this.resultsError.set('A atualização dos resultados está temporariamente indisponível.'));
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
