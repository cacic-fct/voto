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
      this.applySubmittedResponseState(poll, response);
      this.snackBar.open(this.submitSuccessMessage(poll, wasEditing), 'OK', {
        duration: 3000,
      });
    } catch (error) {
      this.error.set(this.submitErrorMessage(error));
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
    return this.pollAccess?.kind === 'directLink'
      ? this.api.submitDirectLinkResponse(this.pollAccess.value, request)
      : this.api.submitResponse(poll.id, request);
  }

  private getMyPollResponse(pollId: string) {
    return this.pollAccess?.kind === 'directLink'
      ? this.api.getMyDirectLinkPollResponse(this.pollAccess.value)
      : this.api.getMyPollResponse(pollId);
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
