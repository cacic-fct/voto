import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type {
  AuthenticatedUser,
  EventManagerEvent,
  PermissionEvaluationResponse,
  Poll,
  PollEligibilityEnrollmentList,
  PollResponse,
  PollResults,
  PollSummary,
  PollUserResponseState,
} from '@org/voting-contracts';

const now = '2026-06-21T12:00:00.000Z';
const coveredFrontendRoutes = [
  '',
  '**',
  'admin',
  'login',
  'polls',
  'polls/:id',
  'polls/direct/:directLinkToken',
] as const;

const voterUser: AuthenticatedUser = {
  sub: 'user-1',
  preferredUsername: 'maria',
  email: 'maria@cacic.dev.br',
  roles: [],
  permissions: [],
  scopes: [],
  oidcScopes: [],
};

const pollSummary: PollSummary = {
  id: 'poll-1',
  title: 'Eleição CACiC 2026',
  description: 'Escolha a próxima gestão do CACiC.',
  status: 'published',
  createdAt: now,
  updatedAt: now,
  publishedAt: now,
  votingStyle: 'secret',
  voterEligibilitySource: 'authenticatedUsers',
  requireVerifiedUnespRole: false,
  directLinkEnabled: false,
  resultsPublic: false,
  resultsLive: false,
  allowResponseEditing: false,
  allowMultipleResponses: false,
  elementCount: 2,
  responseCount: 12,
};

const closedPollSummary: PollSummary = {
  ...pollSummary,
  id: 'poll-closed',
  title: 'Consulta encerrada',
  description: 'Resultado disponível para conferência.',
  status: 'closed',
  resultsPublic: true,
  elementCount: 1,
  responseCount: 42,
};

const poll: Poll = {
  ...pollSummary,
  elements: [
    {
      id: 'choice',
      type: 'singleChoice',
      title: 'Escolha a chapa',
      required: true,
      options: [
        { id: 'integracao', label: 'Chapa Integração' },
        { id: 'renovacao', label: 'Chapa Renovação' },
      ],
    },
    {
      id: 'comment',
      type: 'shortText',
      title: 'Comentário',
      required: false,
      options: [],
    },
  ],
};

const directLinkPoll: Poll = {
  ...poll,
  id: 'direct-poll',
  title: 'Votação por link direto',
  directLinkEnabled: true,
  directLinkToken: 'direct-token',
};

const closedPoll: Poll = {
  ...poll,
  ...closedPollSummary,
  elements: [
    {
      id: 'choice',
      type: 'singleChoice',
      title: 'Escolha encerrada',
      required: true,
      options: [
        { id: 'sim', label: 'Sim' },
        { id: 'nao', label: 'Não' },
      ],
    },
  ],
};

const closedPollResults: PollResults = {
  pollId: closedPoll.id,
  anonymous: false,
  responseCount: 2,
  responses: [
    { id: 'response-1', submittedAt: now, answers: [{ elementId: 'choice', value: 'sim' }] },
    { id: 'response-2', submittedAt: now, answers: [{ elementId: 'choice', value: 'sim' }] },
  ],
};

const emptyResponseState: PollUserResponseState = {
  hasSubmitted: false,
  canEdit: false,
  canSubmitAnother: false,
};

test('declares E2E coverage for every configured Angular route', () => {
  for (const routeFile of ['app.routes.ts', 'app.routes.server.ts']) {
    expect(readRoutePaths(routeFile)).toEqual([...coveredFrontendRoutes].sort());
  }
});

test('shows the login page for anonymous sessions', async ({ page }) => {
  await mockAnonymousSession(page);

  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Entre para continuar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Entrar/ })).toBeVisible();
});

test('redirects root and unknown authenticated routes to polls', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockPublicPolls(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/polls$/);

  await page.goto('/rota-inexistente');
  await expect(page).toHaveURL(/\/polls$/);
});

test('lists published polls and opens a voting page', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockPublicPolls(page);

  await page.goto('/polls');

  await expect(page.getByRole('heading', { name: 'Votações' })).toBeVisible();
  await expect(page.getByText('Eleição CACiC 2026')).toBeVisible();
  await expect(page.getByText('12 respostas')).toBeVisible();
  await expect(page.getByText('Consulta encerrada')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ver resultados/ })).toBeVisible();

  await page.getByRole('link', { name: /Votar/ }).click();

  await expect(page).toHaveURL(/\/polls\/poll-1$/);
  await expect(page.getByRole('heading', { name: 'Eleição CACiC 2026' })).toBeVisible();
  await expect(page.getByText('Escolha a chapa')).toBeVisible();
});

test('submits a poll response through the voting page', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockPublicPolls(page);
  let submittedRequest: unknown;

  await page.route('**/api/polls/poll-1/responses', async (route) => {
    submittedRequest = route.request().postDataJSON();
    const response: PollResponse = {
      id: 'response-1',
      pollId: poll.id,
      submittedAt: now,
      answers: [
        { elementId: 'choice', value: 'integracao' },
        { elementId: 'comment', value: 'Quero uma gestão participativa.' },
      ],
    };

    await route.fulfill({ status: 201, json: response });
  });

  await page.goto('/polls/poll-1');
  await page.getByRole('radio', { name: 'Chapa Integração' }).click();
  await page.getByLabel('Resposta curta').fill('Quero uma gestão participativa.');
  await page.getByRole('button', { name: /Enviar voto/ }).click();

  await expect(page.getByText('Resposta registrada')).toBeVisible();
  expect(submittedRequest).toEqual({
    answers: [
      { elementId: 'choice', value: 'integracao' },
      { elementId: 'comment', value: 'Quero uma gestão participativa.' },
    ],
  });
});

test('submits every supported poll element type', async ({ page }) => {
  const completePoll = createCompletePoll();
  let submittedRequest: unknown;

  await mockAuthenticatedSession(page);
  await mockPublicPolls(page, {
    polls: { [completePoll.id]: completePoll },
    summaries: [pollToSummary(completePoll)],
  });
  await page.route(`**/api/polls/${completePoll.id}/responses`, async (route) => {
    submittedRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        id: 'complete-response',
        pollId: completePoll.id,
        submittedAt: now,
        answers: [],
      } satisfies PollResponse,
    });
  });

  await page.goto(`/polls/${completePoll.id}`);
  await page.getByLabel('Resposta curta').fill('Resumo objetivo');
  await page.getByLabel('Resposta longa').fill('Resposta detalhada para a comissão.');
  await page.getByRole('radio', { name: 'Chapa Integração' }).click();
  await page.getByRole('checkbox', { name: 'Comunicação' }).check();
  await page.getByRole('checkbox', { name: 'Eventos' }).check();
  await page.getByRole('combobox', { name: 'Selecione uma opção' }).click();
  await page.getByRole('option', { name: 'Noite' }).click();
  await page.getByRole('radio', { name: 'Infraestrutura: Alta' }).click();
  await page.getByRole('checkbox', { name: 'Reuniões: Segunda' }).check();
  await page.getByRole('button', { name: '4' }).click();
  await page.getByRole('button', { name: '5 estrelas' }).click();
  await page.getByLabel('Data').fill('2026-06-25');
  await page.getByLabel('Hora').fill('19:30');
  await page.getByRole('button', { name: /09:00 - 09:30/ }).click();
  await page.getByLabel('Nome do convidado 1').fill('Ana Souza');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByRole('button', { name: /Enviar voto/ }).click();

  await expect(page.getByText('Resposta registrada')).toBeVisible();
  expect(submittedRequest).toEqual({
    answers: [
      { elementId: 'section', value: null },
      { elementId: 'statement', value: null },
      { elementId: 'short', value: 'Resumo objetivo' },
      { elementId: 'long', value: 'Resposta detalhada para a comissão.' },
      { elementId: 'single', value: 'integracao' },
      { elementId: 'multiple', value: ['comunicacao', 'eventos'] },
      { elementId: 'dropdown', value: 'noite' },
      { elementId: 'single-grid', value: { infraestrutura: 'alta' } },
      { elementId: 'multiple-grid', value: { reunioes: ['segunda'] } },
      { elementId: 'scale', value: 4 },
      { elementId: 'stars', value: 5 },
      { elementId: 'date', value: '2026-06-25' },
      { elementId: 'time', value: '19:30' },
      {
        elementId: 'scheduling',
        value: {
          slotId: 'availability-1:09:00',
          invitees: [{ name: 'Ana Souza', email: 'ana@example.com' }],
        },
      },
    ],
  });
});

test('opens a direct-link poll route and submits through the direct-link API', async ({ page }) => {
  let submittedRequest: unknown;

  await mockAuthenticatedSession(page);
  await mockPublicPolls(page, {
    directPolls: { 'direct-token': directLinkPoll },
  });
  await page.route('**/api/polls/direct/direct-token/responses', async (route) => {
    submittedRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        id: 'direct-response',
        pollId: directLinkPoll.id,
        submittedAt: now,
        answers: [{ elementId: 'choice', value: 'renovacao' }],
      } satisfies PollResponse,
    });
  });

  await page.goto('/polls/direct/direct-token');
  await page.getByRole('radio', { name: 'Chapa Renovação' }).click();
  await page.getByRole('button', { name: /Enviar voto/ }).click();

  await expect(page.getByText('Resposta registrada')).toBeVisible();
  expect(submittedRequest).toEqual({
    answers: [
      { elementId: 'choice', value: 'renovacao' },
      { elementId: 'comment', value: null },
    ],
  });
});

test('shows public results for a closed poll', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockPublicPolls(page, {
    polls: { [closedPoll.id]: closedPoll },
    results: { [closedPoll.id]: closedPollResults },
    summaries: [closedPollSummary],
  });

  await page.goto('/polls/poll-closed');

  await expect(page.getByRole('heading', { name: 'Consulta encerrada' })).toBeVisible();
  await expect(page.getByText('Votação encerrada')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();
  await expect(page.getByText('2 respostas registradas.')).toBeVisible();
  await expect(page.getByText('Sim')).toBeVisible();
});

test('redirects non-admin users away from the restricted area', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockPublicPolls(page);

  await page.goto('/admin');

  await expect(page).toHaveURL(/\/polls$/);
  await expect(page.getByRole('heading', { name: 'Votações' })).toBeVisible();
});

test('shows the restricted area navigation for administrators', async ({ page }) => {
  await mockAuthenticatedSession(page, ['poll#read']);
  await mockPublicPolls(page);
  await mockAdminApi(page, { summaries: [pollSummary] });

  await page.goto('/polls');
  await page.getByRole('link', { name: 'Área restrita' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Área restrita' })).toBeVisible();
  await expect(page.getByText('Eleição CACiC 2026')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nova votação' })).toBeVisible();
});

test('creates a poll from the admin builder', async ({ page }) => {
  let savedRequest: unknown;

  await mockAuthenticatedSession(page, ['poll#read', 'poll#create', 'poll#edit']);
  await mockAdminApi(page, {
    onCreate: (request) => {
      savedRequest = request;
    },
    summaries: [],
  });

  await page.goto('/admin');
  await page.getByLabel('Título da votação').fill('Assembleia extraordinária');
  await page.getByRole('button', { name: /Adicionar item/ }).click();
  await page.getByRole('menuitem', { name: /Escolha única/ }).click();
  await page.getByLabel('Título do item').fill('Aprovar proposta');
  await page.getByRole('button', { name: /Salvar/ }).click();

  await expect(page.getByText('Votação salva.')).toBeVisible();
  expect(savedRequest).toMatchObject({
    title: 'Assembleia extraordinária',
    elements: [expect.objectContaining({ title: 'Aprovar proposta', type: 'singleChoice' })],
  });
});

test('updates status, deletes polls, and renders admin results', async ({ page }) => {
  const draftPoll = {
    ...poll,
    status: 'draft',
  } satisfies Poll;
  const statuses: string[] = [];
  let deleted = false;

  await mockAuthenticatedSession(page, ['poll#read', 'poll#publish', 'poll#delete']);
  await mockAdminApi(page, {
    initialPoll: draftPoll,
    results: {
      pollId: draftPoll.id,
      anonymous: false,
      responseCount: 1,
      responses: [
        {
          id: 'admin-response-1',
          submittedAt: now,
          voter: {
            userId: 'user-1',
            name: 'Maria Silva',
            email: 'maria@cacic.dev.br',
            unespRole: 'aluno-graduacao',
            enrollmentNumber: '241200001',
          },
          answers: [{ elementId: 'choice', value: 'integracao' }],
        },
      ],
    },
    summaries: [pollToSummary(draftPoll)],
    onDelete: () => {
      deleted = true;
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin');
  await page.getByRole('button', { name: /Eleição CACiC 2026/ }).click();
  await page.getByRole('button', { name: /Publicar/ }).click();
  await expect(page.getByText('Status atualizado.')).toBeVisible();
  await page.getByRole('button', { name: /Encerrar/ }).click();
  await page.getByRole('tab', { name: 'Resultados' }).click();
  await expect(page.getByText('Maria Silva')).toBeVisible();
  await expect(page.getByText('1')).toBeVisible();
  await page.getByRole('button', { name: /Excluir/ }).click();

  expect(statuses).toEqual(['published', 'closed']);
  expect(deleted).toBe(true);
});

test('manages enrollment-list eligibility from the admin builder', async ({ page }) => {
  const enrollmentPoll = {
    ...poll,
    voterEligibilitySource: 'enrollmentList',
  } satisfies Poll;
  let addedRequest: unknown;
  let removedEnrollment: string | null = null;
  let cleared = false;

  await mockAuthenticatedSession(page, ['poll#read', 'poll#edit']);
  await mockAdminApi(page, {
    initialPoll: enrollmentPoll,
    summaries: [pollToSummary(enrollmentPoll)],
    eligibility: {
      entries: [],
      totalCount: 0,
    },
    onAddEnrollment: (request) => {
      addedRequest = request;
    },
    onClearEligibility: () => {
      cleared = true;
    },
    onDeleteEnrollment: (enrollmentNumber) => {
      removedEnrollment = enrollmentNumber;
    },
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin');
  await page.getByRole('button', { name: /Eleição CACiC 2026/ }).click();
  await page.getByLabel('Matrículas').fill('241200001');
  await page.getByRole('button', { name: /^Adicionar$/ }).click();
  await expect(page.getByText('241200001')).toBeVisible();
  await page.getByRole('button', { name: 'Remover matrícula' }).click();
  await page.getByRole('button', { name: /Limpar/ }).click();

  expect(addedRequest).toEqual({ enrollmentNumbers: ['241200001'] });
  expect(removedEnrollment).toBe('241200001');
  expect(cleared).toBe(true);
});

function readRoutePaths(routeFile: string): string[] {
  const routeSource = readFileSync(
    resolve(__dirname, '../../frontend/src/app', routeFile),
    'utf8',
  );
  const matches = [...routeSource.matchAll(/path:\s*'([^']*)'/g)].map((match) => match[1]);
  return [...new Set(matches)].sort();
}

async function mockAnonymousSession(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ json: null });
  });
}

async function mockAuthenticatedSession(page: Page, permissions: string[] = []): Promise<void> {
  const user: AuthenticatedUser = {
    ...voterUser,
    permissions,
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ json: user });
  });

  await page.route('**/api/auth/permissions/evaluate', async (route) => {
    const request = route.request().postDataJSON() as { permissions?: string[] };
    const response: PermissionEvaluationResponse = {
      permissions: (request.permissions ?? []).filter((permission) => permissions.includes(permission)),
    };

    await route.fulfill({ json: response });
  });
}

type PublicPollMocks = {
  directPolls?: Record<string, Poll>;
  directResponseStates?: Record<string, PollUserResponseState>;
  directResults?: Record<string, PollResults>;
  polls?: Record<string, Poll>;
  responseStates?: Record<string, PollUserResponseState>;
  results?: Record<string, PollResults>;
  summaries?: PollSummary[];
};

async function mockPublicPolls(page: Page, mocks: PublicPollMocks = {}): Promise<void> {
  const polls = {
    [poll.id]: poll,
    [closedPoll.id]: closedPoll,
    ...(mocks.polls ?? {}),
  };
  const directPolls = mocks.directPolls ?? {};
  const summaries = mocks.summaries ?? [pollSummary, closedPollSummary];

  await page.route('**/api/polls', async (route) => {
    await route.fulfill({ json: summaries });
  });

  for (const [id, definition] of Object.entries(polls)) {
    await page.route(`**/api/polls/${id}`, async (route) => {
      await route.fulfill({ json: definition });
    });
    await page.route(`**/api/polls/${id}/responses/me`, async (route) => {
      await route.fulfill({ json: mocks.responseStates?.[id] ?? emptyResponseState });
    });
    await page.route(`**/api/polls/${id}/results`, async (route) => {
      await route.fulfill({
        json: mocks.results?.[id] ?? { pollId: id, anonymous: false, responseCount: 0, responses: [] },
      });
    });
  }

  for (const [token, definition] of Object.entries(directPolls)) {
    await page.route(`**/api/polls/direct/${token}`, async (route) => {
      await route.fulfill({ json: definition });
    });
    await page.route(`**/api/polls/direct/${token}/responses/me`, async (route) => {
      await route.fulfill({ json: mocks.directResponseStates?.[token] ?? emptyResponseState });
    });
    await page.route(`**/api/polls/direct/${token}/results`, async (route) => {
      await route.fulfill({
        json: mocks.directResults?.[token] ?? {
          pollId: definition.id,
          anonymous: false,
          responseCount: 0,
          responses: [],
        },
      });
    });
  }
}

type AdminMocks = {
  eligibility?: PollEligibilityEnrollmentList;
  events?: EventManagerEvent[];
  initialPoll?: Poll;
  onAddEnrollment?: (request: unknown) => void;
  onClearEligibility?: () => void;
  onCreate?: (request: unknown) => void;
  onDelete?: () => void;
  onDeleteEnrollment?: (enrollmentNumber: string) => void;
  onStatus?: (status: string) => void;
  results?: PollResults;
  summaries?: PollSummary[];
};

async function mockAdminApi(page: Page, mocks: AdminMocks = {}): Promise<void> {
  let currentPoll = mocks.initialPoll ?? poll;
  let summaries = mocks.summaries ?? [pollToSummary(currentPoll)];
  let eligibility = mocks.eligibility ?? { entries: [], totalCount: 0 };

  await page.route('**/api/admin/polls', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: summaries });
      return;
    }

    if (method === 'POST') {
      const request = route.request().postDataJSON();
      mocks.onCreate?.(request);
      currentPoll = {
        ...currentPoll,
        ...request,
        id: 'saved-poll',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      } as Poll;
      summaries = [pollToSummary(currentPoll)];
      await route.fulfill({ status: 201, json: currentPoll });
      return;
    }

    await route.fulfill({ status: 405 });
  });

  await page.route('**/api/admin/polls/linkable-events', async (route) => {
    await route.fulfill({ json: mocks.events ?? [] });
  });

  await page.route('**/api/admin/polls/*/results', async (route) => {
    await route.fulfill({
      json: mocks.results ?? { pollId: currentPoll.id, anonymous: false, responseCount: 0, responses: [] },
    });
  });

  await page.route('**/api/admin/polls/*/eligibility-enrollments', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: eligibility });
      return;
    }

    if (method === 'POST') {
      const request = route.request().postDataJSON() as { enrollmentNumbers?: string[] };
      mocks.onAddEnrollment?.(request);
      eligibility = {
        entries: (request.enrollmentNumbers ?? []).map((enrollmentNumber) => ({
          pollId: currentPoll.id,
          enrollmentNumber,
          createdAt: now,
          people: [{ enrollmentNumber, name: 'Maria Silva', email: 'maria@cacic.dev.br' }],
        })),
        totalCount: request.enrollmentNumbers?.length ?? 0,
      };
      await route.fulfill({
        status: 201,
        json: {
          ...eligibility,
          createdCount: eligibility.totalCount,
          duplicateCount: 0,
          existingCount: 0,
          invalidCount: 0,
          replacedCount: 0,
        },
      });
      return;
    }

    if (method === 'DELETE') {
      mocks.onClearEligibility?.();
      eligibility = { entries: [], totalCount: 0 };
      await route.fulfill({ json: eligibility });
      return;
    }

    await route.fulfill({ status: 405 });
  });

  await page.route('**/api/admin/polls/*/eligibility-enrollments/*', async (route) => {
    const enrollmentNumber = route.request().url().split('/').pop() ?? '';
    mocks.onDeleteEnrollment?.(decodeURIComponent(enrollmentNumber));
    eligibility = {
      entries: eligibility.entries.filter((entry) => entry.enrollmentNumber !== enrollmentNumber),
      totalCount: Math.max(0, eligibility.totalCount - 1),
    };
    await route.fulfill({ status: 204 });
  });

  await page.route('**/api/admin/polls/*/status', async (route) => {
    const request = route.request().postDataJSON() as { status?: Poll['status'] };
    mocks.onStatus?.(request.status ?? '');
    currentPoll = { ...currentPoll, status: request.status ?? currentPoll.status };
    summaries = [pollToSummary(currentPoll)];
    await route.fulfill({ json: currentPoll });
  });

  await page.route('**/api/admin/polls/*', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: currentPoll });
      return;
    }

    if (method === 'PUT') {
      const request = route.request().postDataJSON();
      currentPoll = { ...currentPoll, ...request } as Poll;
      await route.fulfill({ json: currentPoll });
      return;
    }

    if (method === 'DELETE') {
      mocks.onDelete?.();
      summaries = [];
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fulfill({ status: 405 });
  });
}

function createCompletePoll(): Poll {
  return {
    ...poll,
    id: 'complete-poll',
    title: 'Votação completa',
    elements: [
      { id: 'section', type: 'section', title: 'Bloco inicial', required: false, options: [] },
      { id: 'statement', type: 'statement', title: 'Leia as regras', required: false, options: [] },
      { id: 'short', type: 'shortText', title: 'Resumo', required: true, options: [] },
      { id: 'long', type: 'longText', title: 'Justificativa', required: true, options: [] },
      {
        id: 'single',
        type: 'singleChoice',
        title: 'Chapa',
        required: true,
        options: [
          { id: 'integracao', label: 'Chapa Integração' },
          { id: 'renovacao', label: 'Chapa Renovação' },
        ],
      },
      {
        id: 'multiple',
        type: 'multipleChoice',
        title: 'Prioridades',
        required: true,
        options: [
          { id: 'comunicacao', label: 'Comunicação' },
          { id: 'eventos', label: 'Eventos' },
        ],
      },
      {
        id: 'dropdown',
        type: 'selectionDropdown',
        title: 'Turno',
        required: true,
        options: [
          { id: 'manha', label: 'Manhã' },
          { id: 'noite', label: 'Noite' },
        ],
      },
      {
        id: 'single-grid',
        type: 'singleSelectionGrid',
        title: 'Impacto',
        required: true,
        options: [],
        settings: {
          grid: {
            rows: [{ id: 'infraestrutura', label: 'Infraestrutura' }],
            columns: [{ id: 'alta', label: 'Alta' }, { id: 'baixa', label: 'Baixa' }],
          },
        },
      },
      {
        id: 'multiple-grid',
        type: 'multipleSelectionGrid',
        title: 'Disponibilidade',
        required: true,
        options: [],
        settings: {
          grid: {
            rows: [{ id: 'reunioes', label: 'Reuniões' }],
            columns: [{ id: 'segunda', label: 'Segunda' }, { id: 'sexta', label: 'Sexta' }],
          },
        },
      },
      {
        id: 'scale',
        type: 'linearScale',
        title: 'Confiança',
        required: true,
        options: [],
        settings: { linearScale: { min: 1, max: 5 } },
      },
      {
        id: 'stars',
        type: 'starRating',
        title: 'Avaliação',
        required: true,
        options: [],
        settings: { starRating: { max: 5 } },
      },
      { id: 'date', type: 'date', title: 'Data preferida', required: true, options: [] },
      { id: 'time', type: 'time', title: 'Horário preferido', required: true, options: [] },
      {
        id: 'scheduling',
        type: 'scheduling',
        title: 'Agendamento',
        required: true,
        options: [],
        settings: {
          scheduling: {
            hostName: 'Comissão eleitoral',
            location: 'Sala do CACiC',
            timezone: 'America/Sao_Paulo',
            durationMinutes: 30,
            slotIntervalMinutes: 30,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            inviteeMode: 'optional',
            maxInvitees: 1,
            availability: [{ id: 'availability-1', date: '2026-06-25', startTime: '09:00', endTime: '10:00' }],
          },
        },
      },
    ],
  };
}

function pollToSummary(definition: Poll): PollSummary {
  return {
    ...definition,
    elementCount: definition.elements.length,
    responseCount: definition.id === 'poll-1' ? 12 : 0,
  };
}
