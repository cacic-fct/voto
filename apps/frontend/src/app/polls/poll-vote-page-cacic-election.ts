import {
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionSlate,
  Poll,
  PollElement,
  SubmitCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import {
  CacicElectionBallotOption,
  cacicElectionBallotOptions,
  cacicElectionVoteElement,
  isCacicElectionPoll,
  isCacicElectionVotingPoll,
  isSlateSubmissionPoll,
  memberEnrollmentYearLabel,
  slateRoleLabel,
  slateStatusLabel,
  voteFormElements,
} from './poll-vote-cacic-election';
import { PollVotePageScheduling } from './poll-vote-page-scheduling';

export abstract class PollVotePageCacicElection extends PollVotePageScheduling {
  protected async submitSlate(
    poll: Poll,
    request: SubmitCacicElectionSlateRequest,
  ): Promise<void> {
    this.savingSlate.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.submitCacicElectionSlate(poll.id, request));
      await this.loadCacicElectionSlates(poll);
      await this.loadMyCacicElectionSlate(poll);
      this.snackBar.open('Chapa enviada para revisão.', 'OK', {
        duration: 3000,
      });
    } catch {
      this.error.set(
        'Não foi possível enviar a chapa. Confira os campos obrigatórios.',
      );
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected isSlateSubmissionPoll(poll: Poll): boolean {
    return isSlateSubmissionPoll(poll);
  }

  protected isCacicElectionPoll(poll: Poll): boolean {
    return isCacicElectionPoll(poll);
  }

  protected isCacicElectionVotingPoll(poll: Poll): boolean {
    return isCacicElectionVotingPoll(poll);
  }

  protected cacicElectionVoteElement(poll: Poll): PollElement | null {
    return cacicElectionVoteElement(poll);
  }

  protected voteFormElements(poll: Poll): PollElement[] {
    return voteFormElements(poll);
  }

  protected cacicElectionBallotOptions(
    poll: Poll,
  ): CacicElectionBallotOption[] {
    return cacicElectionBallotOptions(poll, this.slates());
  }

  protected setCacicElectionVote(optionId: string): void {
    this.answers.update((answers) => ({
      ...answers,
      [CACIC_ELECTION_VOTE_ELEMENT_ID]: optionId,
    }));
  }

  protected isCacicElectionVoteSelected(optionId: string): boolean {
    return this.answers()[CACIC_ELECTION_VOTE_ELEMENT_ID] === optionId;
  }

  protected memberEnrollmentYearLabel(
    member: CacicElectionSlate['members'][number],
  ): string {
    return memberEnrollmentYearLabel(member);
  }

  protected slateStatusLabel(status: CacicElectionSlate['status']): string {
    return slateStatusLabel(status);
  }

  protected slateRoleLabel(
    role: CacicElectionSlate['members'][number]['role'],
    customRole?: string,
  ): string {
    return slateRoleLabel(role, customRole);
  }

  protected async loadCacicElectionSlates(poll: Poll): Promise<void> {
    if (
      !this.isCacicElectionVotingPoll(poll) ||
      this.pollAccess?.kind === 'directLink'
    ) {
      this.slates.set([]);
      return;
    }

    this.loadingSlates.set(true);
    try {
      this.slates.set(
        await firstValueFrom(this.api.listPublicCacicElectionSlates(poll.id)),
      );
    } catch {
      this.slates.set([]);
    } finally {
      this.loadingSlates.set(false);
    }
  }

  protected async loadMyCacicElectionSlate(poll: Poll): Promise<void> {
    if (!this.isSlateSubmissionPoll(poll)) {
      this.mySlate.set(null);
      return;
    }

    this.loadingSlates.set(true);
    try {
      this.mySlate.set(
        await firstValueFrom(this.api.getMyCacicElectionSlate(poll.id)),
      );
    } catch {
      this.mySlate.set(null);
    } finally {
      this.loadingSlates.set(false);
    }
  }
}
