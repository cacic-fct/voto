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
  protected retryResponseState(poll: Poll): void {
    void this.loadUserResponseState(poll);
  }

  protected async submit(poll: Poll): Promise<void> {
    const generation = this.pollLoadGeneration;
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
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
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
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      if (this.isKioskMode) {
        await this.router.navigate(
          ['/admin/polls', poll.id, 'kiosk'],
          { replaceUrl: true, queryParams: { reason: 'submit' } },
        );
      } else {
        this.error.set(this.submitErrorMessage(error));
      }
    } finally {
      if (this.isPollLoadCurrent(generation)) {
        this.saving.set(false);
      }
    }
  }

  protected async loadUserResponseState(
    poll: Poll,
    generation = this.pollLoadGeneration,
  ): Promise<void> {
    if (!this.isPollLoadCurrent(generation)) {
      return;
    }

    if (this.isSlateSubmissionPoll(poll)) {
      this.responseStateError.set(null);
      this.responseState.set(emptyResponseState);
      return;
    }

    this.loadingResponseState.set(true);
    this.responseStateError.set(null);
    this.responseState.set(emptyResponseState);
    try {
      const state = await firstValueFrom(this.getMyPollResponse(poll.id));
      if (!this.isPollLoadCurrent(generation)) {
        return;
      }
      this.responseState.set(state);
      if (state.canEdit && state.response && !state.canSubmitAnother) {
        this.applyResponseAnswers(state.response.answers);
      }
    } catch {
      if (this.isPollLoadCurrent(generation)) {
        this.responseStateError.set(
          'Não foi possível confirmar se você já votou. O envio ficará bloqueado até a verificação ser concluída.',
        );
      }
    } finally {
      if (this.isPollLoadCurrent(generation)) {
        this.loadingResponseState.set(false);
      }
    }
  }

  private submitPollResponse(
    poll: Poll,
    request: { answers: PollResponseAnswer[] },
  ) {
    const access = this.pollAccess();
    return this.isKioskMode
      ? this.api.submitKioskResponse(poll.id, request)
      : access?.kind === 'directLink'
      ? this.api.submitDirectLinkResponse(access.value, request)
      : this.api.submitResponse(poll.id, request);
  }

  private getMyPollResponse(pollId: string) {
    const access = this.pollAccess();
    return this.isKioskMode
      ? this.api.getKioskVoterResponse(pollId)
      : access?.kind === 'directLink'
      ? this.api.getMyDirectLinkPollResponse(access.value)
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
