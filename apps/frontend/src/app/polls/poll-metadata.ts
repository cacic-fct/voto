import { PollVoterEligibilitySource, PollVotingStyle } from '@org/voting-contracts';

export type VotingStyleMetadata = {
  label: string;
  adminDescription: string;
  voterDescription: string;
  icon: string;
};

export type VoterEligibilityMetadata = {
  label: string;
  description: string;
  icon: string;
  requiresLinkedEvent: boolean;
};

export const VOTING_STYLE_METADATA: Record<PollVotingStyle, VotingStyleMetadata> = {
  public: {
    label: 'Público',
    adminDescription: 'Todos os habilitados a votar podem visualizar quem votou e os votos individuais.',
    voterDescription: 'Pessoas habilitadas a votar poderão visualizar participantes e votos individuais.',
    icon: 'visibility',
  },
  partiallySecret: {
    label: 'Parcialmente sigiloso',
    adminDescription: 'Habilitados a votar podem visualizar quem votou, mas não os votos individuais.',
    voterDescription: 'Pessoas habilitadas a votar poderão visualizar quem participou, sem votos individuais.',
    icon: 'group',
  },
  secret: {
    label: 'Sigiloso',
    adminDescription: 'Apenas administradores podem visualizar quem votou e os votos, preservando o sigilo.',
    voterDescription: 'Apenas administradores do sistema podem consultar participantes e votos.',
    icon: 'lock',
  },
  anonymous: {
    label: 'Anônimo',
    adminDescription: 'Administradores auditam quem votou, mas as respostas ficam sem usuário e sem horário.',
    voterDescription: 'O sistema registra que você votou, mas sua resposta fica sem usuário e sem horário.',
    icon: 'shield_lock',
  },
};

export const VOTER_ELIGIBILITY_METADATA: Record<PollVoterEligibilitySource, VoterEligibilityMetadata> = {
  authenticatedUsers: {
    label: 'Usuários autenticados',
    description: 'Todos os usuários autenticados estão habilitados a votar.',
    icon: 'person_check',
    requiresLinkedEvent: false,
  },
  unespUsers: {
    label: 'Unespianos',
    description: 'Apenas usuários com e-mail principal ou secundário @unesp.br estão habilitados a votar.',
    icon: 'school',
    requiresLinkedEvent: false,
  },
  computerScienceStudents: {
    label: 'Alunos da computação',
    description: 'Apenas alunos da graduação com matrícula de Ciência da Computação estão habilitados a votar.',
    icon: 'terminal',
    requiresLinkedEvent: false,
  },
  eventAttendance: {
    label: 'Presença no evento - todos',
    description: 'Apenas usuários com presença registrada no evento vinculado estão habilitados a votar.',
    icon: 'event_available',
    requiresLinkedEvent: true,
  },
  eventAttendanceUnespUsers: {
    label: 'Presença no evento - unespianos',
    description: 'Apenas unespianos com presença registrada no evento vinculado estão habilitados a votar.',
    icon: 'event_available',
    requiresLinkedEvent: true,
  },
  eventAttendanceComputerScienceStudents: {
    label: 'Presença no evento - alunos da computação',
    description:
      'Apenas alunos da graduação em Ciência da Computação com presença registrada no evento vinculado estão habilitados a votar.',
    icon: 'event_available',
    requiresLinkedEvent: true,
  },
  enrollmentList: {
    label: 'Lista de matrículas',
    description: 'Apenas matrículas cadastradas manualmente ou importadas por arquivo estão habilitadas a votar.',
    icon: 'format_list_numbered',
    requiresLinkedEvent: false,
  },
};

export const votingStyleOptions = Object.entries(VOTING_STYLE_METADATA).map(([style, metadata]) => ({
  style: style as PollVotingStyle,
  ...metadata,
}));

export const voterEligibilityOptions = Object.entries(VOTER_ELIGIBILITY_METADATA).map(([source, metadata]) => ({
  source: source as PollVoterEligibilitySource,
  ...metadata,
}));

export function votingStyleLabel(style: PollVotingStyle): string {
  return VOTING_STYLE_METADATA[style].label;
}

export function votingStyleVoterDescription(style: PollVotingStyle): string {
  return VOTING_STYLE_METADATA[style].voterDescription;
}

export function voterEligibilityLabel(source: PollVoterEligibilitySource): string {
  return VOTER_ELIGIBILITY_METADATA[source].label;
}

export function voterEligibilityDescription(source: PollVoterEligibilitySource): string {
  return VOTER_ELIGIBILITY_METADATA[source].description;
}

export function requiresLinkedEventEligibilitySource(source: PollVoterEligibilitySource): boolean {
  return VOTER_ELIGIBILITY_METADATA[source].requiresLinkedEvent;
}

export function supportsVerifiedUnespRoleRequirement(source: PollVoterEligibilitySource): boolean {
  return source === 'computerScienceStudents' || source === 'eventAttendanceComputerScienceStudents';
}
