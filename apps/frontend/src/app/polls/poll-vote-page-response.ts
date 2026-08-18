import {
  Poll,
  PollResponse,
  PollResponseAnswer,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import {
  responseAnswersToAnswerMap,
} from './poll-vote-answer-state';
import { emptyResponseState } from './poll-vote-availability';
import { PollVotePageCacicElection } from './poll-vote-page-cacic-election';
import {
  buildPollResponseAnswers,
  submitErrorMessage as buildSubmitErrorMessage,
  submitSuccessMessage as buildSubmitSuccessMessage,
  submittedResponseStateUpdate,
} from './poll-vote-response-state';

export abstract class PollVotePageResponse extends PollVotePageCacicElection {
  protected async submit(poll: Poll): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    const wasEditing = Boolean(
      this.responseState().canEdit && this.responseState().response,
    );

    const answers = buildPollResponseAnswers(poll, this.answers());

    try {
      const response = await firstValueFrom(
        this.submitPollResponse(poll, { answers }),
      );
      if (this.isKioskMode) {
        this.snackBar.open('Voto registrado.', 'OK', { duration: 3000 });
        await this.router.navigate(
          ['/admin/polls', poll.id, 'kiosk'],
          { replaceUrl: true, queryParams: { registered: '1' } },
        );
        return;
      }
      this.applySubmittedResponseState(poll, response);
      this.snackBar.open(this.submitSuccessMessage(poll, wasEditing), 'OK', {
        duration: 3000,
      });
    } catch (error) {
      if (this.isKioskMode) {
        await this.router.navigate(
          ['/admin/polls', poll.id, 'kiosk'],
          { replaceUrl: true, queryParams: { reason: 'submit' } },
        );
      } else {
        this.error.set(this.submitErrorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected async loadUserResponseState(poll: Poll): Promise<void> {
    if (this.isSlateSubmissionPoll(poll)) {
      this.responseState.set(emptyResponseState);
      return;
    }

    this.loadingResponseState.set(true);
    this.responseState.set(emptyResponseState);
    try {
      const state = await firstValueFrom(this.getMyPollResponse(poll.id));
      this.responseState.set(state);
      if (state.canEdit && state.response && !state.canSubmitAnother) {
        this.applyResponseAnswers(state.response.answers);
      }
    } catch {
      this.responseState.set(emptyResponseState);
    } finally {
      this.loadingResponseState.set(false);
    }
  }

  private submitPollResponse(
    poll: Poll,
    request: { answers: PollResponseAnswer[] },
  ) {
    return this.isKioskMode
      ? this.api.submitKioskResponse(poll.id, request)
      : this.pollAccess?.kind === 'directLink'
      ? this.api.submitDirectLinkResponse(this.pollAccess.value, request)
      : this.api.submitResponse(poll.id, request);
  }

  private getMyPollResponse(pollId: string) {
    return this.isKioskMode
      ? this.api.getKioskVoterResponse(pollId)
      : this.pollAccess?.kind === 'directLink'
      ? this.api.getMyDirectLinkPollResponse(this.pollAccess.value)
      : this.api.getMyPollResponse(pollId);
  }

  protected async cancelKioskVote(pollId: string): Promise<void> {
    try {
      await firstValueFrom(this.api.cancelKioskAuthorization(pollId));
    } finally {
      await this.router.navigate(['/admin/polls', pollId, 'kiosk'], {
        replaceUrl: true,
      });
    }
  }

  private submitErrorMessage(error: unknown): string {
    return buildSubmitErrorMessage(error, this.poll()?.voterEligibilitySource);
  }

  private applySubmittedResponseState(
    poll: Poll,
    response: PollResponse,
  ): void {
    const update = submittedResponseStateUpdate(poll, response);
    this.responseState.set(update.responseState);
    if (update.answers) {
      this.answers.set(update.answers);
    }
  }

  private applyResponseAnswers(answers: PollResponseAnswer[]): void {
    this.answers.set(responseAnswersToAnswerMap(answers));
  }

  private submitSuccessMessage(poll: Poll, wasEditing: boolean): string {
    return buildSubmitSuccessMessage(poll, wasEditing);
  }
}
