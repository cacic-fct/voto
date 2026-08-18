import { firstValueFrom } from 'rxjs';
import { PublicPollAccess } from './poll-vote-access';
import { PollVotePageResults } from './poll-vote-page-results';

export abstract class PollVotePageLoader extends PollVotePageResults {
  constructor() {
    super();
    void this.loadPoll();
  }

  private async loadPoll(): Promise<void> {
    if (!this.pollAccess) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }

    try {
      const poll = await this.loadAccessiblePoll(this.pollAccess);
      this.poll.set(poll);
      await this.loadCacicElectionSlates(poll);
      if (this.isSlateSubmissionPoll(poll)) {
        await this.loadMyCacicElectionSlate(poll);
      } else {
        await this.loadUserResponseState(poll);
      }
    } catch {
      if (this.isKioskMode) {
        await this.router.navigate(
          ['/admin/polls', this.pollAccess.value, 'kiosk'],
          { replaceUrl: true, queryParams: { reason: 'expired' } },
        );
      } else {
        this.error.set('Não foi possível carregar a votação.');
      }
    } finally {
      this.loading.set(false);
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
