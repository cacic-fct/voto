import {
  Poll,
  PollResultsDelta,
  PollVoterEligibilitySource,
} from '@org/voting-contracts';
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
      if (poll.status === 'published' && poll.resultsLive) {
        this.openPublicResultsEvents(poll.id);
      }
    } catch {
      this.resultsError.set(
        'Não foi possível carregar os resultados públicos.',
      );
    } finally {
      this.loadingResults.set(false);
    }
  }

  protected closeResultsEvents(): void {
    this.resultsEvents?.close();
    this.resultsEvents = undefined;
  }

  protected shouldShowPublicResults(poll: Poll): boolean {
    return canShowPublicResults(poll);
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
        ? this.api.openDirectLinkPollResultsEvents(this.pollAccess.value, 0)
        : this.api.openPublicPollResultsEvents(pollId, 0);
    source.onmessage = (event) => {
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
      }
    };
    this.resultsEvents = source;
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => applyResultsDeltaToResults(current, delta));
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
