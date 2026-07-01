import type {
  AdminCacicElectionSlate,
  CacicElectionSlate,
  Poll,
  PollSummary,
  SubmitCacicElectionSlateRequest,
} from '@org/voting-contracts';

export const electionFixtureNow = '2026-06-21T12:00:00.000Z';

export function createSlateSubmissionPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    allowMultipleResponses: false,
    allowResponseEditing: false,
    cacicElectionPhase: 'slateSubmission',
    createdAt: electionFixtureNow,
    directLinkEnabled: false,
    elements: [],
    id: 'cacic-slate-submission',
    mode: 'cacicElection',
    requireVerifiedUnespRole: false,
    resultsLive: false,
    resultsPublic: false,
    status: 'published',
    title: 'Eleições do CACiC - submissão de chapas',
    updatedAt: electionFixtureNow,
    voterEligibilitySource: 'authenticatedUsers',
    votingStyle: 'secret',
    ...overrides,
  };
}

export function createElectionPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    ...createSlateSubmissionPoll(),
    cacicElectionPhase: 'election',
    elements: [
      {
        id: 'cacic-election-vote',
        type: 'singleChoice',
        title: 'Escolha a chapa',
        description: 'Selecione uma chapa aprovada ou registre voto em branco ou nulo.',
        required: true,
        options: [
          { id: 'slate:slate-1', label: 'Chapa Integração', description: '6 integrantes' },
          { id: 'cacic-election-blank', label: 'Branco', description: 'Registrar voto em branco.' },
          { id: 'cacic-election-null', label: 'Nulo', description: 'Registrar voto nulo.' },
        ],
      },
    ],
    id: 'cacic-election',
    title: 'Eleições do CACiC',
    votingStyle: 'anonymous',
    voterEligibilitySource: 'enrollmentList',
    ...overrides,
  };
}

export function pollToE2eSummary(poll: Poll, responseCount = 0): PollSummary {
  return {
    ...poll,
    elementCount: poll.elements.length,
    responseCount,
  };
}

export function createSlateRequest(): SubmitCacicElectionSlateRequest {
  return {
    name: 'Chapa Integração',
    members: [
      createSlateMember('Ana Presidente', '26123456', 'president', true, 'ana@example.com'),
      createSlateMember('Bia Vice', '25123456', 'vicePresident', false, 'bia@example.com'),
      createSlateMember('Caio Financeiro', '24123456', 'financialDirector', false, 'caio@example.com'),
      createSlateMember('Duda Comunicação', '23123456', 'communicationDirector', false, 'duda@example.com'),
      createSlateMember('Eva Eventos', '22123456', 'eventsDirector', false, 'eva@example.com'),
      createSlateMember('Fabio Relações', '21123456', 'publicRelationsDirector', false, 'fabio@example.com'),
    ],
  };
}

export function createSlate(overrides: Partial<CacicElectionSlate> = {}): CacicElectionSlate {
  return {
    enabled: true,
    id: 'slate-1',
    members: createSlateRequest().members.map((member, index) => ({
      id: `slate-1-member-${index + 1}`,
      fullName: member.fullName,
      enrollmentYear: readEnrollmentYear(member.enrollmentNumber),
      role: member.role,
      isRepresentative: member.isRepresentative,
    })),
    name: 'Chapa Integração',
    pollId: 'cacic-election',
    reviewedAt: electionFixtureNow,
    status: 'approved',
    submissionSource: 'public',
    submittedAt: electionFixtureNow,
    submittedBy: {
      userId: 'user-1',
      name: 'Ana Presidente',
      preferredUsername: 'ana',
      email: 'ana@example.com',
    },
    ...overrides,
  };
}

export function createAdminSlate(overrides: Partial<AdminCacicElectionSlate> = {}): AdminCacicElectionSlate {
  const request = createSlateRequest();

  return {
    ...createSlate(),
    members: request.members.map((member, index) => ({
      id: `slate-1-member-${index + 1}`,
      fullName: member.fullName,
      enrollmentNumber: member.enrollmentNumber,
      enrollmentYear: readEnrollmentYear(member.enrollmentNumber),
      role: member.role,
      isRepresentative: member.isRepresentative,
      identifierType: member.identifierType,
      identifierValue: member.identifierValue,
    })),
    ...overrides,
  };
}

function readEnrollmentYear(enrollmentNumber: string | undefined): string | undefined {
  return enrollmentNumber?.slice(0, 2);
}

function createSlateMember(
  fullName: string,
  enrollmentNumber: string,
  role: SubmitCacicElectionSlateRequest['members'][number]['role'],
  isRepresentative: boolean,
  email: string,
): SubmitCacicElectionSlateRequest['members'][number] {
  return {
    fullName,
    enrollmentNumber,
    role,
    isRepresentative,
    identifierType: 'email',
    identifierValue: email,
  };
}
