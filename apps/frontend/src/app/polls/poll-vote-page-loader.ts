import { effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PublicPollAccess } from './poll-vote-access';
import { emptyResponseState } from './poll-vote-availability';
import { PollVotePageResults } from './poll-vote-page-results';

export abstract class PollVotePageLoader extends PollVotePageResults {
  constructor() {
    super();
    effect(() => {
      const access = this.pollAccess();
      void this.loadPoll(access);
    });
  }

  private async loadPoll(access: PublicPollAccess | null): Promise<void> {
    const generation = this.beginPollLoad();
    this.closeResultsEvents();
    this.poll.set(null);
    this.answers.set({});
    this.results.set(null);
    this.slates.set([]);
    this.mySlate.set(null);
    this.kioskVoter.set(null);
    this.responseState.set(emptyResponseState);
    this.responseStateError.set(null);
    this.saving.set(false);
    this.savingSlate.set(false);
    this.loadingResults.set(false);
    this.loadingSlates.set(false);
    this.loadingResponseState.set(false);
    this.resultsError.set(null);
    this.resultsFinalizationState.set('idle');
    this.resultsFinalizationError.set(null);
    this.pendingFinalResultsPollId.set(null);
    this.resultsConnectionState.set('connecting');
    this.error.set(null);
    this.loading.set(true);

    if (!access) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }

    try {
      const poll = await this.loadAccessiblePoll(access);
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      this.poll.set(poll);
      await this.loadCacicElectionSlates(poll, generation);
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      if (this.isSlateSubmissionPoll(poll)) {
        await this.loadMyCacicElectionSlate(poll, generation);
      } else {
        await this.loadUserResponseState(poll, generation);
      }
    } catch {
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }

      if (this.isKioskMode) {
        await this.router.navigate(
          ['/admin/polls', access.value, 'kiosk'],
          { replaceUrl: true, queryParams: { reason: 'expired' } },
        );
      } else {
        this.error.set('Não foi possível carregar a votação.');
      }
    } finally {
      if (this.isPollLoadCurrent(generation)) {
        this.loading.set(false);
      }
    }
  }

  private async loadAccessiblePoll(access: PublicPollAccess) {
    if (this.isKioskMode) {
      const context = await firstValueFrom(
        this.api.getKioskVotingContext(access.value),
      );
      this.kioskVoter.set(context.voter);
      return context.poll;
    }
    return firstValueFrom(this.getPoll(access));
  }

  private getPoll(access: PublicPollAccess) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPoll(access.value)
      : this.api.getPublicPoll(access.value);
  }
}
