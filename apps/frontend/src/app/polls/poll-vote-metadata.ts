import { Poll, PollVoterEligibilitySource } from '@org/voting-contracts';
import {
  voterEligibilityDescription,
  voterEligibilityLabel,
  votingStyleLabel,
  votingStyleVoterDescription,
} from './poll-metadata';

export type PollMetadataSummaryItem = {
  icon: string;
  label: string;
  value: string;
};

export type PollMetadataRuleItem = {
  icon: string;
  text: string;
};

export function buildPollMetadataSummaryItems(poll: Poll): PollMetadataSummaryItem[] {
  const items: PollMetadataSummaryItem[] = [
    {
      icon: poll.votingStyle === 'anonymous' ? 'visibility_off' : 'lock',
      label: 'Nível de sigilo',
      value: votingStyleLabel(poll.votingStyle),
    },
    {
      icon: 'how_to_reg',
      label: 'Habilitação',
      value: voterEligibilityLabel(poll.voterEligibilitySource),
    },
  ];

  if (poll.linkedEvent) {
    items.push({
      icon: 'event',
      label: 'Evento',
      value: poll.linkedEvent.name,
    });
  }

  return items;
}

export function buildPollMetadataRuleItems(poll: Poll): PollMetadataRuleItem[] {
  const items: PollMetadataRuleItem[] = [
    {
      icon: poll.votingStyle === 'anonymous' ? 'shield' : 'admin_panel_settings',
      text: votingStyleVoterDescription(poll.votingStyle),
    },
    {
      icon: 'verified_user',
      text: voterEligibilityDescription(poll.voterEligibilitySource),
    },
  ];

  if (poll.allowResponseEditing) {
    items.push({
      icon: 'edit',
      text: 'Você poderá editar sua resposta enquanto a votação estiver aberta.',
    });
  }

  if (poll.allowMultipleResponses) {
    items.push({
      icon: 'add_circle',
      text: 'Você poderá enviar mais de uma resposta enquanto a votação estiver aberta.',
    });
  }

  if (poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'election') {
    items.push({
      icon: 'bar_chart',
      text: 'Os resultados da eleição serão liberados somente após o encerramento.',
    });
  }

  return items;
}

export function voterEligibilityDeniedMessage(
  source: PollVoterEligibilitySource | undefined,
): string {
  switch (source) {
    case 'eventAttendance':
      return 'Esta votação está disponível apenas para pessoas com presença registrada no evento vinculado.';
    case 'eventAttendanceUnespUsers':
      return 'Esta votação está disponível apenas para unespianos com presença registrada no evento vinculado.';
    case 'eventAttendanceComputerScienceStudents':
      return 'Esta votação está disponível apenas para alunos da computação com presença registrada no evento vinculado.';
    case 'unespUsers':
      return 'Esta votação está disponível apenas para unespianos.';
    case 'computerScienceStudents':
      return 'Esta votação está disponível apenas para alunos da computação.';
    case 'enrollmentList':
      return 'Esta votação está disponível apenas para matrículas cadastradas na lista de habilitados.';
    case 'authenticatedUsers':
    case undefined:
      return 'Você não está habilitado a votar nesta votação.';
  }
}
