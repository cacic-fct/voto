import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, LOCALE_ID, inject, provideAppInitializer } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { fakerPT_BR as faker } from '@faker-js/faker';
import { HttpResponse, delay, http, type RequestHandler } from 'msw';
import {
  AuthenticatedUser,
  EventManagerEvent,
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  Poll,
  PollAnswerValue,
  PollElement,
  PollEligibilityEnrollment,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollImage,
  PollResponse,
  PollResults,
  PollStatus,
  PollSummary,
  PollUserResponseState,
  PollVoterEligibilitySource,
  PollVotingStyle,
  SubmitPollResponseRequest,
  VOTING_ADMIN_PERMISSIONS,
} from '@org/voting-contracts';

registerLocaleData(localePt);

export const storybookBaseProviders: NonNullable<ApplicationConfig['providers']> = [
  { provide: LOCALE_ID, useValue: 'pt-BR' },
  provideHttpClient(withFetch()),
  provideNoopAnimations(),
  provideAppInitializer(() => {
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
  }),
];

export const apiStateOptions = ['carregado', 'vazio', 'erro', 'carregando'] as const;
export type ApiStoryState = (typeof apiStateOptions)[number];

export const submitStateOptions = ['sucesso', 'naoAutorizado', 'semPermissao', 'duplicado', 'erro'] as const;
export type SubmitStoryState = (typeof submitStateOptions)[number];

export const votingStyleControlOptions = [...POLL_VOTING_STYLES];
export const voterEligibilityControlOptions = [...POLL_VOTER_ELIGIBILITY_SOURCES];

export const votingStyleControlLabels: Record<PollVotingStyle, string> = {
  public: 'Público',
  partiallySecret: 'Parcialmente sigiloso',
  secret: 'Sigiloso',
  anonymous: 'Anônimo',
};

export const voterEligibilityControlLabels: Record<PollVoterEligibilitySource, string> = {
  authenticatedUsers: 'Usuários autenticados',
  unespUsers: 'Unespianos',
  computerScienceStudents: 'Alunos da computação',
  eventAttendance: 'Presença no evento - todos',
  eventAttendanceUnespUsers: 'Presença no evento - unespianos',
  eventAttendanceComputerScienceStudents: 'Presença no evento - alunos da computação',
  enrollmentList: 'Lista de matrículas',
};

export type VotingStoryState = {
  adminPollCount: number;
  adminPollsState: ApiStoryState;
  eligibilityEnrollmentCount: number;
  includeLinkedEvent: boolean;
  linkableEventsState: ApiStoryState;
  linkedEventCount: number;
  pollDescription: string;
  pollDetailState: ApiStoryState;
  pollElementCount: number;
  pollTitle: string;
  publicPollCount: number;
  publicPollsState: ApiStoryState;
  seed: number;
  submitState: SubmitStoryState;
  voterEligibilitySource: PollVoterEligibilitySource;
  votingStyle: PollVotingStyle;
  requireVerifiedUnespRole: boolean;
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
};

const defaultVotingStoryState: VotingStoryState = {
  adminPollCount: 4,
  adminPollsState: 'carregado',
  eligibilityEnrollmentCount: 6,
  includeLinkedEvent: true,
  linkableEventsState: 'carregado',
  linkedEventCount: 3,
  pollDescription: 'Escolha as opções que representam melhor a decisão coletiva.',
  pollDetailState: 'carregado',
  pollElementCount: 5,
  pollTitle: 'Votação da assembleia geral',
  publicPollCount: 4,
  publicPollsState: 'carregado',
  seed: 42,
  submitState: 'sucesso',
  voterEligibilitySource: 'authenticatedUsers',
  votingStyle: 'secret',
  requireVerifiedUnespRole: false,
  allowResponseEditing: false,
  allowMultipleResponses: false,
};

let votingStoryState = defaultVotingStoryState;

export function setVotingStoryState(state: Partial<VotingStoryState>): void {
  votingStoryState = {
    ...votingStoryState,
    ...state,
  };
}

export function createStoryUser(email: string, isAdmin: boolean): AuthenticatedUser {
  return {
    sub: 'storybook-user',
    preferredUsername: email.split('@')[0],
    email,
    roles: isAdmin ? ['voting-admin'] : ['authenticated-user'],
    permissions: isAdmin ? [...VOTING_ADMIN_PERMISSIONS] : [],
    scopes: ['openid', 'profile', 'email'],
    oidcScopes: ['openid', 'profile', 'email'],
  };
}

export const votingMswHandlers: RequestHandler[] = [
  http.get('/api/auth/me', () => HttpResponse.json(createStoryUser('usuario@cacic.dev', true))),
  http.post('/api/auth/permissions/evaluate', () =>
    HttpResponse.json({
      permissions: [...VOTING_ADMIN_PERMISSIONS],
    }),
  ),
  http.post('/api/auth/logout', () =>
    HttpResponse.json({
      logoutUrl: '/',
    }),
  ),
  http.get('/api/polls', async () =>
    resolveListState(votingStoryState.publicPollsState, () => createPollSummaries(votingStoryState.publicPollCount)),
  ),
  http.get('/api/polls/:id/responses/me', ({ params }) =>
    HttpResponse.json<PollUserResponseState>(createUserResponseState(String(params['id'] ?? 'poll-story'))),
  ),
  http.get('/api/polls/:id', async ({ params }) =>
    resolvePollState(votingStoryState.pollDetailState, createPoll(String(params['id'] ?? 'poll-story'))),
  ),
  http.post('/api/polls/:id/responses', async ({ params, request }) => {
    const body = (await request.json()) as SubmitPollResponseRequest;

    switch (votingStoryState.submitState) {
      case 'naoAutorizado':
        return HttpResponse.json({ message: 'Autenticação necessária.' }, { status: 401 });
      case 'semPermissao':
        return HttpResponse.json({ message: 'Usuário sem permissão para votar.' }, { status: 403 });
      case 'duplicado':
        return HttpResponse.json({ message: 'Resposta já registrada.' }, { status: 409 });
      case 'erro':
        return HttpResponse.json({ message: 'Erro ao registrar resposta.' }, { status: 422 });
      case 'sucesso':
        return HttpResponse.json<PollResponse>({
          id: `response-${votingStoryState.seed}`,
          pollId: String(params['id'] ?? 'poll-story'),
          answers: body.answers,
          submittedAt: new Date('2026-06-16T12:00:00.000Z').toISOString(),
        });
    }
  }),
  http.get('/api/admin/polls/linkable-events', async () =>
    resolveListState(votingStoryState.linkableEventsState, () => createEvents(votingStoryState.linkedEventCount)),
  ),
  http.get('/api/admin/polls', async () =>
    resolveListState(votingStoryState.adminPollsState, () => createPollSummaries(votingStoryState.adminPollCount)),
  ),
  http.get('/api/admin/polls/:id/eligibility-enrollments', () =>
    HttpResponse.json<PollEligibilityEnrollmentList>(createEligibilityEnrollmentList()),
  ),
  http.get('/api/admin/polls/:id/results', ({ params }) =>
    HttpResponse.json<PollResults>(createPollResults(String(params['id'] ?? 'admin-poll-story'))),
  ),
  http.post('/api/admin/polls/:id/eligibility-enrollments', async ({ request }) => {
    const body = (await request.json()) as { enrollmentNumbers?: string[] };
    return HttpResponse.json<PollEligibilityEnrollmentImportResult>(
      createEligibilityImportResult(body.enrollmentNumbers?.length ?? 0),
    );
  }),
  http.put('/api/admin/polls/:id/eligibility-enrollments/import', () =>
    HttpResponse.json<PollEligibilityEnrollmentImportResult>(createEligibilityImportResult(4)),
  ),
  http.delete('/api/admin/polls/:id/eligibility-enrollments', () =>
    HttpResponse.json<PollEligibilityEnrollmentList>({
      entries: [],
      totalCount: 0,
    }),
  ),
  http.delete('/api/admin/polls/:id/eligibility-enrollments/:enrollmentNumber', () => HttpResponse.json(null)),
  http.get('/api/admin/polls/:id', async ({ params }) =>
    resolvePollState(votingStoryState.adminPollsState, createPoll(String(params['id'] ?? 'admin-poll-story'))),
  ),
  http.post('/api/admin/polls/:id/images', async ({ params }) =>
    HttpResponse.json<PollImage>(createPollImage(String(params['id'] ?? 'admin-poll-story'))),
  ),
  http.delete('/api/admin/polls/:id/images/:imageId', () => HttpResponse.json(null)),
  http.post('/api/admin/polls', async ({ request }) => {
    const body = (await request.json()) as Partial<Poll>;
    return HttpResponse.json(createPoll('poll-created', body.title || 'Nova votação salva', body));
  }),
  http.put('/api/admin/polls/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<Poll>;
    return HttpResponse.json(
      createPoll(String(params['id'] ?? 'poll-updated'), body.title || votingStoryState.pollTitle, body),
    );
  }),
  http.patch('/api/admin/polls/:id/status', async ({ params, request }) => {
    const body = (await request.json()) as { status?: PollStatus };
    return HttpResponse.json({
      ...createPoll(String(params['id'] ?? 'poll-status')),
      status: body.status ?? 'published',
      publishedAt: body.status === 'published' ? new Date('2026-06-16T12:00:00.000Z').toISOString() : undefined,
    });
  }),
  http.get('/api/polls/:id/images/:imageId', () =>
    new HttpResponse(tinyPngBytes(), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, max-age=86400',
      },
    }),
  ),
  http.delete('/api/admin/polls/:id', () => HttpResponse.json(null)),
];

async function resolveListState<T>(state: ApiStoryState, createItems: () => T[]) {
  if (state === 'carregando') {
    await delay('infinite');
  }

  if (state === 'erro') {
    return HttpResponse.json({ message: 'Erro simulado no Storybook.' }, { status: 500 });
  }

  if (state === 'vazio') {
    return HttpResponse.json([]);
  }

  return HttpResponse.json(createItems());
}

async function resolvePollState(state: ApiStoryState, poll: Poll) {
  if (state === 'carregando') {
    await delay('infinite');
  }

  if (state === 'erro') {
    return HttpResponse.json({ message: 'Votação não encontrada no mock.' }, { status: 404 });
  }

  if (state === 'vazio') {
    return HttpResponse.json({
      ...poll,
      elements: [],
    });
  }

  return HttpResponse.json(poll);
}

function createPollSummaries(count: number): PollSummary[] {
  return withSeed(votingStoryState.seed + count, () =>
    Array.from({ length: Math.max(0, count) }, (_, index) => {
      const poll = createPoll(`poll-${index + 1}`, index === 0 ? votingStoryState.pollTitle : undefined);
      return {
        id: poll.id,
        title: poll.title,
        description: poll.description,
        status: index % 3 === 2 ? 'closed' : 'published',
        createdAt: poll.createdAt,
        updatedAt: poll.updatedAt,
        publishedAt: poll.publishedAt,
        linkedEvent: poll.linkedEvent,
        votingStyle: poll.votingStyle,
        voterEligibilitySource: poll.voterEligibilitySource,
        requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
        directLinkEnabled: poll.directLinkEnabled,
        resultsPublic: poll.resultsPublic,
        resultsLive: poll.resultsLive,
        allowResponseEditing: poll.allowResponseEditing,
        allowMultipleResponses: poll.allowMultipleResponses,
        elementCount: poll.elements.length,
        responseCount: faker.number.int({ min: 3, max: 180 }),
      };
    }),
  );
}

function createPoll(id: string, title = votingStoryState.pollTitle, overrides: Partial<Poll> = {}): Poll {
  return withSeed(votingStoryState.seed + id.length, () => {
    const linkedEvent = votingStoryState.includeLinkedEvent ? createEvents(1)[0] : undefined;
    const votingStyle = overrides.votingStyle ?? votingStoryState.votingStyle;
    const allowMultipleResponses = overrides.allowMultipleResponses ?? votingStoryState.allowMultipleResponses;
    const allowResponseEditing =
      votingStyle !== 'anonymous' &&
      !allowMultipleResponses &&
      (overrides.allowResponseEditing ?? votingStoryState.allowResponseEditing);

    const elements = overrides.elements ?? createPollElements(votingStoryState.pollElementCount);

    return {
      id,
      title,
      description: overrides.description ?? votingStoryState.pollDescription,
      descriptionImages: coercePollImages(id, (overrides as { descriptionImages?: unknown }).descriptionImages),
      status: overrides.status ?? 'published',
      votingStyle,
      voterEligibilitySource: overrides.voterEligibilitySource ?? votingStoryState.voterEligibilitySource,
      requireVerifiedUnespRole: overrides.requireVerifiedUnespRole ?? votingStoryState.requireVerifiedUnespRole,
      directLinkEnabled: overrides.directLinkEnabled ?? false,
      directLinkToken: overrides.directLinkToken,
      resultsPublic: overrides.resultsPublic ?? false,
      resultsLive: overrides.resultsLive ?? false,
      allowResponseEditing,
      allowMultipleResponses,
      linkedEvent,
      elements: elements.map((element) => ({
        ...element,
        descriptionImages: coercePollImages(id, (element as { descriptionImages?: unknown }).descriptionImages),
      })),
      createdAt: new Date('2026-06-10T10:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-06-15T18:30:00.000Z').toISOString(),
      publishedAt: new Date('2026-06-15T18:30:00.000Z').toISOString(),
    };
  });
}

function coercePollImages(pollId: string, value: unknown): PollImage[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item, index) => {
      const id = typeof item['id'] === 'string' && item['id'] ? item['id'] : `image-${index + 1}`;
      return {
        id,
        url: typeof item['url'] === 'string' ? item['url'] : `/api/polls/${pollId}/images/${id}`,
        width: typeof item['width'] === 'number' ? item['width'] : 800,
        height: typeof item['height'] === 'number' ? item['height'] : 450,
        altText: typeof item['altText'] === 'string' ? item['altText'] : undefined,
        caption: typeof item['caption'] === 'string' ? item['caption'] : undefined,
      };
    });
}

function createPollImage(pollId: string): PollImage {
  const id = `image-${faker.string.alphanumeric(8).toLowerCase()}`;
  return {
    id,
    url: `/api/polls/${pollId}/images/${id}`,
    width: 800,
    height: 450,
    altText: 'Imagem adicionada à votação.',
  };
}

function tinyPngBytes(): Uint8Array {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  return Uint8Array.from(globalThis.atob(base64), (char) => char.charCodeAt(0));
}

function createUserResponseState(pollId: string): PollUserResponseState {
  const poll = createPoll(pollId);
  if (votingStoryState.submitState === 'duplicado') {
    const answers = poll.elements
      .filter((element) => element.type !== 'section' && element.type !== 'statement')
      .map((element, index) => ({
        elementId: element.id,
        value: createResultAnswerValue(element, index),
      }));

    return {
      hasSubmitted: true,
      canEdit: poll.status === 'published' && poll.allowResponseEditing && poll.votingStyle !== 'anonymous',
      canSubmitAnother: poll.status === 'published' && poll.allowMultipleResponses,
      ...(poll.votingStyle === 'anonymous'
        ? {}
        : {
            response: {
              id: `response-current-${votingStoryState.seed}`,
              pollId,
              answers,
              submittedAt: new Date('2026-06-16T12:00:00.000Z').toISOString(),
            },
          }),
    };
  }

  return {
    hasSubmitted: false,
    canEdit: false,
    canSubmitAnother: poll.status === 'published' && poll.allowMultipleResponses,
  };
}

function createEligibilityEnrollmentList(): PollEligibilityEnrollmentList {
  const entries: PollEligibilityEnrollment[] = withSeed(votingStoryState.seed + 300, () =>
    Array.from({ length: Math.max(0, votingStoryState.eligibilityEnrollmentCount) }, (_, index) => {
      const enrollmentNumber = `${20260000 + index + 1}`;

      return {
        pollId: 'poll-story',
        enrollmentNumber,
        createdAt: new Date(Date.UTC(2026, 5, 16, 10, index, 0)).toISOString(),
        people: [
          {
            enrollmentNumber,
            name: faker.person.fullName(),
            email: faker.internet.email().toLowerCase(),
          },
        ],
      };
    }),
  );

  return {
    entries,
    totalCount: entries.length,
  };
}

function createEligibilityImportResult(createdCount: number): PollEligibilityEnrollmentImportResult {
  const list = createEligibilityEnrollmentList();

  return {
    ...list,
    createdCount,
    duplicateCount: 0,
    existingCount: Math.max(0, list.totalCount - createdCount),
    invalidCount: 0,
    replacedCount: 0,
  };
}

function createPollResults(pollId: string): PollResults {
  const poll = createPoll(pollId);
  const responseCount = Math.max(0, Math.min(36, Math.max(6, votingStoryState.eligibilityEnrollmentCount * 3)));
  const courseCodes = ['12', '34', '56'];
  const roles = ['aluno-graduacao', 'aluno-pos-graduacao', 'docente'];

  return withSeed(votingStoryState.seed + 600, () => ({
    pollId,
    anonymous: poll.votingStyle === 'anonymous',
    responseCount,
    responses: Array.from({ length: responseCount }, (_, responseIndex) => {
      const courseCode = courseCodes[responseIndex % courseCodes.length];
      const enrollmentNumber = `${String(26 - (responseIndex % 5)).padStart(2, '0')}${courseCode}${String(
        responseIndex + 1,
      ).padStart(5, '0')}`;

      return {
        id: `response-${responseIndex + 1}`,
        submittedAt: new Date(Date.UTC(2026, 5, 18, 12, responseIndex, 0)).toISOString(),
        voter:
          poll.votingStyle === 'anonymous'
            ? undefined
            : {
                userId: `user-${responseIndex + 1}`,
                name: faker.person.fullName(),
                preferredUsername: faker.internet.username().toLowerCase(),
                email: faker.internet.email().toLowerCase(),
                unespRole: roles[responseIndex % roles.length],
                enrollmentNumber,
              },
        answers: poll.elements
          .filter((element) => element.type !== 'section' && element.type !== 'statement')
          .map((element) => ({
            elementId: element.id,
            value: createResultAnswerValue(element, responseIndex),
          })),
      };
    }),
  }));
}

function createResultAnswerValue(element: PollElement, responseIndex: number): PollAnswerValue {
  switch (element.type) {
    case 'shortText':
      return faker.person.firstName();
    case 'longText':
      return faker.lorem.sentence({ min: 8, max: 18 });
    case 'singleChoice':
    case 'selectionDropdown':
      return element.options[responseIndex % element.options.length]?.id ?? null;
    case 'multipleChoice':
      return element.options
        .filter((_, optionIndex) => (optionIndex + responseIndex) % 2 === 0)
        .map((option) => option.id);
    case 'singleSelectionGrid':
      return Object.fromEntries(
        (element.settings?.grid?.rows ?? []).map((row, rowIndex) => [
          row.id,
          element.settings?.grid?.columns[(rowIndex + responseIndex) % (element.settings.grid.columns.length || 1)]
            ?.id ?? '',
        ]),
      );
    case 'multipleSelectionGrid':
      return Object.fromEntries(
        (element.settings?.grid?.rows ?? []).map((row, rowIndex) => [
          row.id,
          (element.settings?.grid?.columns ?? [])
            .filter((_, columnIndex) => (columnIndex + rowIndex + responseIndex) % 2 === 0)
            .map((column) => column.id),
        ]),
      );
    case 'linearScale': {
      const scale = element.settings?.linearScale;
      const min = scale?.min ?? 1;
      const max = scale?.max ?? 5;
      return min + (responseIndex % (max - min + 1));
    }
    case 'starRating':
      return 1 + (responseIndex % (element.settings?.starRating?.max ?? 5));
    case 'date':
      return `2026-06-${String(18 + (responseIndex % 7)).padStart(2, '0')}`;
    case 'time':
      return `${String(8 + (responseIndex % 10)).padStart(2, '0')}:00`;
    case 'scheduling': {
      const availability = element.settings?.scheduling?.availability[0];
      return availability
        ? {
            slotId: `${availability.id}:${responseIndex % 2 === 0 ? '09:00' : '09:30'}`,
            invitees: [
              {
                name: faker.person.fullName(),
                email: faker.internet.email().toLowerCase(),
              },
            ],
          }
        : null;
    }
    case 'section':
    case 'statement':
      return null;
  }
}

function createPollElements(count: number): PollElement[] {
  const elements: PollElement[] = [
    {
      id: 'section-context',
      type: 'section',
      title: 'Contexto',
      description: 'Leia as informações antes de responder.',
      required: false,
      options: [],
    },
    {
      id: 'statement-guidance',
      type: 'statement',
      title: 'Orientação',
      description: faker.lorem.sentence({ min: 9, max: 14 }),
      required: false,
      options: [],
    },
    {
      id: 'single-choice-priority',
      type: 'singleChoice',
      title: 'Qual proposta deve ser priorizada?',
      description: 'Selecione uma alternativa.',
      required: true,
      options: [
        { id: 'accessibility', label: 'Acessibilidade', description: 'Melhorias para participação ampla.' },
        { id: 'transparency', label: 'Transparência', description: 'Relatórios públicos e auditáveis.' },
        { id: 'operations', label: 'Operação', description: 'Fluxos internos mais eficientes.' },
      ],
    },
    {
      id: 'multiple-choice-support',
      type: 'multipleChoice',
      title: 'Quais apoios são necessários?',
      description: 'Marque todas as opções aplicáveis.',
      required: true,
      options: [
        { id: 'communication', label: 'Comunicação' },
        { id: 'training', label: 'Capacitação' },
        { id: 'infrastructure', label: 'Infraestrutura' },
      ],
    },
    {
      id: 'selection-dropdown-shift',
      type: 'selectionDropdown',
      title: 'Qual turno você prefere?',
      description: 'Escolha uma opção da lista.',
      required: true,
      options: [
        { id: 'morning', label: 'Manhã' },
        { id: 'afternoon', label: 'Tarde' },
        { id: 'night', label: 'Noite' },
      ],
    },
    {
      id: 'single-grid-agreement',
      type: 'singleSelectionGrid',
      title: 'Avalie cada proposta',
      description: 'Selecione uma alternativa por linha.',
      required: true,
      options: [],
      settings: {
        grid: {
          rows: [
            { id: 'student-support', label: 'Apoio estudantil' },
            { id: 'events', label: 'Eventos técnicos' },
            { id: 'representation', label: 'Representação' },
          ],
          columns: [
            { id: 'low', label: 'Baixa' },
            { id: 'medium', label: 'Média' },
            { id: 'high', label: 'Alta' },
          ],
        },
      },
    },
    {
      id: 'multiple-grid-availability',
      type: 'multipleSelectionGrid',
      title: 'Disponibilidade por período',
      description: 'Marque os períodos possíveis para cada atividade.',
      required: false,
      options: [],
      settings: {
        grid: {
          rows: [
            { id: 'meeting', label: 'Reuniões' },
            { id: 'assembly', label: 'Assembleias' },
            { id: 'workshop', label: 'Oficinas' },
          ],
          columns: [
            { id: 'monday', label: 'Segunda' },
            { id: 'wednesday', label: 'Quarta' },
            { id: 'friday', label: 'Sexta' },
          ],
        },
      },
    },
    {
      id: 'linear-scale-confidence',
      type: 'linearScale',
      title: 'Qual seu nível de confiança na proposta?',
      description: 'Use a escala de 1 a 5.',
      required: true,
      options: [],
      settings: {
        linearScale: {
          min: 1,
          max: 5,
          minLabel: 'Baixa',
          maxLabel: 'Alta',
        },
      },
    },
    {
      id: 'star-rating-event',
      type: 'starRating',
      title: 'Como você avalia a organização?',
      description: 'Selecione de 1 a 5 estrelas.',
      required: false,
      options: [],
      settings: {
        starRating: {
          max: 5,
        },
      },
    },
    {
      id: 'date-availability',
      type: 'date',
      title: 'Melhor data para a próxima reunião',
      description: 'Informe a data preferida.',
      required: false,
      options: [],
    },
    {
      id: 'time-availability',
      type: 'time',
      title: 'Melhor horário',
      description: 'Informe o horário preferido.',
      required: false,
      options: [],
    },
    {
      id: 'scheduling-office-hours',
      type: 'scheduling',
      title: 'Escolha um horário para atendimento',
      description: 'Selecione um horário disponível e informe convidados se necessário.',
      required: false,
      options: [],
      settings: {
        scheduling: {
          hostName: 'Comissão eleitoral',
          location: 'Sala do CACiC ou Google Meet',
          timezone: 'America/Sao_Paulo',
          durationMinutes: 30,
          slotIntervalMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          inviteeMode: 'optional',
          maxInvitees: 2,
          availability: [
            {
              id: 'availability-1',
              date: '2026-06-24',
              startTime: '09:00',
              endTime: '12:00',
            },
            {
              id: 'availability-2',
              date: '2026-06-25',
              startTime: '14:00',
              endTime: '17:00',
            },
          ],
        },
      },
    },
    {
      id: 'long-text-comment',
      type: 'longText',
      title: 'Comentário adicional',
      description: 'Registre observações que ajudem a comissão.',
      required: false,
      options: [],
    },
    {
      id: 'short-text-contact',
      type: 'shortText',
      title: 'Representante responsável',
      description: 'Informe o nome da pessoa indicada.',
      required: false,
      options: [],
    },
  ];

  return elements.slice(0, Math.max(0, Math.min(count, elements.length)));
}

function createEvents(count: number): EventManagerEvent[] {
  return withSeed(votingStoryState.seed + 100 + count, () =>
    Array.from({ length: Math.max(0, count) }, (_, index) => {
      const start = new Date(Date.UTC(2026, 5, 18 + index, 12, 0, 0));
      const end = new Date(Date.UTC(2026, 5, 18 + index, 15, 0, 0));

      return {
        id: `event-${index + 1}`,
        name: `${faker.company.catchPhrase()} CACiC`,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        locationDescription: `${faker.location.streetAddress()}, ${faker.location.city()}`,
        shouldCollectAttendance: true,
      };
    }),
  );
}

function withSeed<T>(seed: number, createValue: () => T): T {
  faker.seed(seed);
  return createValue();
}
