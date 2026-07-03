import {
  AdminCacicElectionSlate,
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionSlate,
  Poll,
  PollElement,
} from '@org/voting-contracts';

export type CacicElectionBallotOption = {
  id: string;
  label: string;
  description?: string;
  slate?: CacicElectionSlate;
};

export function isSlateSubmissionPoll(poll: Poll): boolean {
  return poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'slateSubmission';
}

export function isCacicElectionPoll(poll: Poll): boolean {
  return poll.mode === 'cacicElection';
}

export function isCacicElectionVotingPoll(poll: Poll): boolean {
  return poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'election';
}

export function cacicElectionVoteElement(poll: Poll): PollElement | null {
  return poll.elements.find((element) => element.id === CACIC_ELECTION_VOTE_ELEMENT_ID) ?? null;
}

export function voteFormElements(poll: Poll): PollElement[] {
  return poll.elements.filter((element) => element.id !== CACIC_ELECTION_VOTE_ELEMENT_ID);
}

export function cacicElectionBallotOptions(
  poll: Poll,
  slates: readonly CacicElectionSlate[],
): CacicElectionBallotOption[] {
  const voteElement = cacicElectionVoteElement(poll);
  if (!voteElement) {
    return [];
  }

  const slatesByOptionId = new Map(slates.map((slate) => [cacicElectionSlateOptionId(slate.id), slate]));
  return voteElement.options.map((option) => {
    const slate = slatesByOptionId.get(option.id);
    return {
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(slate ? { slate } : {}),
    };
  });
}

export function memberEnrollmentYearLabel(member: CacicElectionSlate['members'][number]): string {
  if (!member.enrollmentYear) {
    return 'Ano não informado';
  }

  const normalizedYear = member.enrollmentYear.trim();
  return /^\d{2}$/.test(normalizedYear) ? `20${normalizedYear}` : normalizedYear;
}

export function slateStatusLabel(status: CacicElectionSlate['status']): string {
  switch (status) {
    case 'pending':
      return 'Pendente';
    case 'approved':
      return 'Aprovada';
    case 'rejected':
      return 'Rejeitada';
  }
}

export function slateRoleLabel(
  role: AdminCacicElectionSlate['members'][number]['role'],
  customRole?: string,
): string {
  switch (role) {
    case 'president':
      return 'Presidente';
    case 'vicePresident':
      return 'Vice-Presidente';
    case 'financialDirector':
      return 'Diretor Financeiro';
    case 'communicationDirector':
      return 'Diretor de Comunicação';
    case 'eventsDirector':
      return 'Diretor de Eventos';
    case 'publicRelationsDirector':
      return 'Diretor de Relações Públicas';
    case 'other':
      return customRole || 'Outro';
  }
}

function cacicElectionSlateOptionId(slateId: string): string {
  return `slate:${slateId}`;
}
