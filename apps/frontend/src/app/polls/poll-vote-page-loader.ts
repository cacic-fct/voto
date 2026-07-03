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
      const poll = await firstValueFrom(this.getPoll(this.pollAccess));
      this.poll.set(poll);
      await this.loadCacicElectionSlates(poll);
      if (this.isSlateSubmissionPoll(poll)) {
        await this.loadMyCacicElectionSlate(poll);
      } else {
        await this.loadUserResponseState(poll);
      }
    } catch {
      this.error.set('Não foi possível carregar a votação.');
    } finally {
      this.loading.set(false);
    }
  }

  private getPoll(access: PublicPollAccess) {
    return access.kind === 'directLink'
      ? this.api.getDirectLinkPoll(access.value)
      : this.api.getPublicPoll(access.value);
  }
}
