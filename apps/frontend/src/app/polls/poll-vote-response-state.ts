import { HttpErrorResponse } from '@angular/common/http';
import {
  Poll,
  PollResponse,
  PollResponseAnswer,
  PollUserResponseState,
  PollVoterEligibilitySource,
} from '@org/voting-contracts';
import { AnswerMap, responseAnswersToAnswerMap } from './poll-vote-answer-state';
import { voterEligibilityDeniedMessage } from './poll-vote-metadata';

export type SubmittedResponseStateUpdate = {
  responseState: PollUserResponseState;
  answers?: AnswerMap;
};

export function buildPollResponseAnswers(
  poll: Poll,
  answers: AnswerMap,
): PollResponseAnswer[] {
  return poll.elements.map((element) => ({
    elementId: element.id,
    value: answers[element.id] ?? null,
  }));
}

export function submittedResponseStateUpdate(
  poll: Poll,
  response: PollResponse,
): SubmittedResponseStateUpdate {
  if (poll.allowMultipleResponses) {
    return {
      responseState: {
        hasSubmitted: true,
        canEdit: false,
        canSubmitAnother: true,
      },
      answers: {},
    };
  }

  if (poll.allowResponseEditing && poll.votingStyle !== 'anonymous') {
    return {
      responseState: {
        hasSubmitted: true,
        canEdit: true,
        canSubmitAnother: false,
        response,
      },
      answers: responseAnswersToAnswerMap(response.answers),
    };
  }

  return {
    responseState: {
      hasSubmitted: true,
      canEdit: false,
      canSubmitAnother: false,
    },
  };
}

export function submitSuccessMessage(poll: Poll, wasEditing: boolean): string {
  if (wasEditing) {
    return 'Resposta atualizada.';
  }

  return poll.allowMultipleResponses
    ? 'Resposta registrada. Você pode enviar outra resposta.'
    : 'Voto registrado.';
}

export function submitErrorMessage(
  error: unknown,
  voterEligibilitySource: PollVoterEligibilitySource | undefined,
): string {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'Entre para votar nesta votação.';
  }

  if (error instanceof HttpErrorResponse && error.status === 403) {
    return voterEligibilityDeniedMessage(voterEligibilitySource);
  }

  if (error instanceof HttpErrorResponse && error.status === 409) {
    return 'Sua resposta já foi registrada nesta votação.';
  }

  return 'Não foi possível registrar sua resposta. Confira os campos obrigatórios.';
}
