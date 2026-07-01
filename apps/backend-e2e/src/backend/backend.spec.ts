import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Readable } from 'node:stream';
import request from 'supertest';
import { of } from 'rxjs';
import {
  AdminCacicElectionSlate,
  CacicElectionSlate,
  Poll,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollImage,
  PollResponse,
  PollResults,
  PollUserResponseState,
  SubmitCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { AppController } from '@org/backend/app/app.controller';
import { AppService } from '@org/backend/app/app.service';
import { AuthGuard } from '@org/backend/app/auth/auth.guard';
import { AuthController } from '@org/backend/app/auth/auth.controller';
import { AuthenticatedPrincipal } from '@org/backend/app/auth/auth.types';
import { KeycloakAuthService } from '@org/backend/app/auth/keycloak-auth.service';
import { AdminPollsController } from '@org/backend/app/polls/admin-polls.controller';
import { PollImagesService } from '@org/backend/app/polls/poll-images.service';
import { PollsService } from '@org/backend/app/polls/polls.service';
import { PublicPollsController } from '@org/backend/app/polls/public-polls.controller';

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

type ErrorPayload = {
  error?: string;
  message?: string | string[];
  statusCode?: number;
};

type OpenApiDocument = {
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
  info?: {
    title?: string;
    version?: string;
  };
  paths?: Record<string, unknown>;
};

type RouteCase = {
  body?: Record<string, unknown>;
  method: HttpMethod;
  route: string;
  url: string;
};

type PublicRouteCase = RouteCase & {
  expectedStatus: number;
};

type AuthMock = jest.Mocked<
  Pick<
    KeycloakAuthService,
    | 'authenticateSession'
    | 'buildAuthorizationUrl'
    | 'clearSession'
    | 'consumeAuthorizationState'
    | 'createSession'
    | 'evaluateSessionPermissions'
    | 'exchangeCodeForTokens'
    | 'getPostLoginRedirectUri'
    | 'getSessionLogoutInput'
    | 'logout'
    | 'refreshSession'
  >
>;

type PollsMock = jest.Mocked<
  Pick<
    PollsService,
    | 'addEligibilityEnrollments'
    | 'assertPublishedDirectLinkPollReadable'
    | 'assertPublishedPollReadable'
    | 'clearEligibilityEnrollments'
    | 'createAdminCacicElectionSlate'
    | 'createPoll'
    | 'deleteCacicElectionSlate'
    | 'deleteEligibilityEnrollment'
    | 'deletePoll'
    | 'exportCacicElectionVoterEnrollments'
    | 'getAdminPoll'
    | 'getAdminPollResults'
    | 'getDirectLinkPublicPollResults'
    | 'getDirectLinkUserResponseState'
    | 'getMyCacicElectionSlate'
    | 'getPublishedPoll'
    | 'getPublishedPollByDirectLink'
    | 'getPublicPollResults'
    | 'getUserResponseState'
    | 'importEligibilityEnrollments'
    | 'listAdminPolls'
    | 'listAdminCacicElectionSlates'
    | 'listEligibilityEnrollments'
    | 'listLinkableEvents'
    | 'listPublicCacicElectionSlates'
    | 'rejectCacicElectionSlate'
    | 'listPublicPolls'
    | 'streamAdminPollResults'
    | 'streamDirectLinkPublicPollResults'
    | 'streamPublicPollResults'
    | 'submitCacicElectionSlate'
    | 'submitDirectLinkResponse'
    | 'submitResponse'
    | 'updateAdminCacicElectionSlate'
    | 'updateCacicElectionSlateEnabled'
    | 'updatePoll'
    | 'updatePollStatus'
  >
>;

type PollImagesMock = jest.Mocked<Pick<PollImagesService, 'deletePollImage' | 'getPollImage' | 'uploadPollImage'>>;

const publicRouteCases = [
  { method: 'get', route: '/api', url: '/api', expectedStatus: 200 },
  { method: 'get', route: '/api/auth/login', url: '/api/auth/login', expectedStatus: 200 },
  { method: 'get', route: '/api/auth/login/redirect', url: '/api/auth/login/redirect', expectedStatus: 302 },
  { method: 'get', route: '/api/auth/callback', url: '/api/auth/callback?code=code-1&state=state-1', expectedStatus: 400 },
  { method: 'get', route: '/api/auth/me', url: '/api/auth/me', expectedStatus: 200 },
  { method: 'post', route: '/api/auth/refresh', url: '/api/auth/refresh', expectedStatus: 403 },
  { method: 'post', route: '/api/auth/logout', url: '/api/auth/logout', expectedStatus: 201 },
] satisfies PublicRouteCase[];

const protectedRouteCases = [
  { method: 'post', route: '/api/auth/permissions/evaluate', url: '/api/auth/permissions/evaluate', body: { permissions: ['poll#read'] } },
  { method: 'get', route: '/api/polls', url: '/api/polls' },
  { method: 'get', route: '/api/polls/direct/:directLinkToken', url: '/api/polls/direct/direct-token' },
  { method: 'get', route: '/api/polls/direct/:directLinkToken/images/:imageId', url: '/api/polls/direct/direct-token/images/image-1' },
  { method: 'get', route: '/api/polls/direct/:directLinkToken/results', url: '/api/polls/direct/direct-token/results' },
  { method: 'get', route: '/api/polls/direct/:directLinkToken/responses/me', url: '/api/polls/direct/direct-token/responses/me' },
  { method: 'get', route: '/api/polls/direct/:directLinkToken/results/events', url: '/api/polls/direct/direct-token/results/events' },
  { method: 'post', route: '/api/polls/direct/:directLinkToken/responses', url: '/api/polls/direct/direct-token/responses', body: { answers: [] } },
  { method: 'get', route: '/api/polls/:id', url: '/api/polls/poll-1' },
  { method: 'get', route: '/api/polls/:id/images/:imageId', url: '/api/polls/poll-1/images/image-1' },
  { method: 'get', route: '/api/polls/:id/results', url: '/api/polls/poll-1/results' },
  { method: 'get', route: '/api/polls/:id/responses/me', url: '/api/polls/poll-1/responses/me' },
  { method: 'get', route: '/api/polls/:id/results/events', url: '/api/polls/poll-1/results/events' },
  { method: 'get', route: '/api/polls/:id/cacic-election/slates', url: '/api/polls/poll-1/cacic-election/slates' },
  { method: 'get', route: '/api/polls/:id/cacic-election/slates/me', url: '/api/polls/poll-1/cacic-election/slates/me' },
  { method: 'put', route: '/api/polls/:id/cacic-election/slates/me', url: '/api/polls/poll-1/cacic-election/slates/me', body: createSlateRequest() },
  { method: 'post', route: '/api/polls/:id/responses', url: '/api/polls/poll-1/responses', body: { answers: [] } },
  { method: 'get', route: '/api/admin/polls', url: '/api/admin/polls' },
  { method: 'get', route: '/api/admin/polls/linkable-events', url: '/api/admin/polls/linkable-events' },
  { method: 'get', route: '/api/admin/polls/:id/eligibility-enrollments', url: '/api/admin/polls/poll-1/eligibility-enrollments' },
  { method: 'post', route: '/api/admin/polls/:id/eligibility-enrollments', url: '/api/admin/polls/poll-1/eligibility-enrollments', body: { enrollmentNumbers: ['20240001'] } },
  { method: 'put', route: '/api/admin/polls/:id/eligibility-enrollments/import', url: '/api/admin/polls/poll-1/eligibility-enrollments/import', body: { format: 'txt', content: '20240001' } },
  { method: 'delete', route: '/api/admin/polls/:id/eligibility-enrollments', url: '/api/admin/polls/poll-1/eligibility-enrollments' },
  { method: 'delete', route: '/api/admin/polls/:id/eligibility-enrollments/:enrollmentNumber', url: '/api/admin/polls/poll-1/eligibility-enrollments/20240001' },
  { method: 'get', route: '/api/admin/polls/:id/results', url: '/api/admin/polls/poll-1/results' },
  { method: 'get', route: '/api/admin/polls/:id/cacic-election/voter-enrollments.txt', url: '/api/admin/polls/poll-1/cacic-election/voter-enrollments.txt' },
  { method: 'get', route: '/api/admin/polls/:id/results/events', url: '/api/admin/polls/poll-1/results/events' },
  { method: 'get', route: '/api/admin/polls/:id/cacic-election/slates', url: '/api/admin/polls/poll-1/cacic-election/slates' },
  { method: 'post', route: '/api/admin/polls/:id/cacic-election/slates', url: '/api/admin/polls/poll-1/cacic-election/slates', body: createSlateRequest() },
  { method: 'put', route: '/api/admin/polls/:id/cacic-election/slates/:slateId', url: '/api/admin/polls/poll-1/cacic-election/slates/slate-1', body: { ...createSlateRequest(), status: 'approved' } },
  { method: 'patch', route: '/api/admin/polls/:id/cacic-election/slates/:slateId/rejection', url: '/api/admin/polls/poll-1/cacic-election/slates/slate-1/rejection', body: { reason: 'Documentos incompletos.' } },
  { method: 'patch', route: '/api/admin/polls/:id/cacic-election/slates/:slateId/enabled', url: '/api/admin/polls/poll-1/cacic-election/slates/slate-1/enabled', body: { enabled: false } },
  { method: 'delete', route: '/api/admin/polls/:id/cacic-election/slates/:slateId', url: '/api/admin/polls/poll-1/cacic-election/slates/slate-1' },
  { method: 'get', route: '/api/admin/polls/:id', url: '/api/admin/polls/poll-1' },
  { method: 'post', route: '/api/admin/polls/:id/images', url: '/api/admin/polls/poll-1/images' },
  { method: 'delete', route: '/api/admin/polls/:id/images/:imageId', url: '/api/admin/polls/poll-1/images/image-1' },
  { method: 'post', route: '/api/admin/polls', url: '/api/admin/polls', body: { title: 'Votação de integração', elements: [] } },
  { method: 'put', route: '/api/admin/polls/:id', url: '/api/admin/polls/poll-1', body: { title: 'Votação de integração', elements: [] } },
  { method: 'patch', route: '/api/admin/polls/:id/status', url: '/api/admin/polls/poll-1/status', body: { status: 'published' } },
  { method: 'delete', route: '/api/admin/polls/:id', url: '/api/admin/polls/poll-1' },
] satisfies RouteCase[];

describe('API integration coverage', () => {
  const originalEnv = process.env;
  let app: INestApplication;
  let auth: AuthMock;
  let polls: PollsMock;
  let pollImages: PollImagesMock;

  beforeAll(async () => {
    process.env = {
      ...originalEnv,
      KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS: 'http://localhost:3000',
      KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS: 'http://localhost:4200',
      KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS: 'http://localhost:4200',
      KEYCLOAK_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    };

    auth = createAuthMock();
    polls = createPollsMock();
    pollImages = createPollImagesMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController, AuthController, PublicPollsController, AdminPollsController],
      providers: [
        AppService,
        { provide: KeycloakAuthService, useValue: auth },
        { provide: PollsService, useValue: polls },
        { provide: PollImagesService, useValue: pollImages },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    resetMocks(auth, polls, pollImages);
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it.each(publicRouteCases)('covers public route $method $route', async (route) => {
    const res = await requestRoute(app, route);

    expect(res.status).toBe(route.expectedStatus);
  });

  it('returns the public API status payload', async () => {
    const res = await request(app.getHttpServer()).get('/api');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', name: 'CACiC Voto API' });
  });

  it('builds login URLs and stores the OAuth state cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/login?returnTo=/polls');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authorizationUrl: 'https://sso.example/auth' });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('cacic_voto_oauth_state=state-1')]),
    );
    expect(auth.buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'http://localhost:3000/api/auth/callback',
        returnTo: '/polls',
      }),
    );
  });

  it('redirects browser login requests to Keycloak', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/login/redirect');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://sso.example/auth');
  });

  it('returns null for an anonymous identity lookup', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.text).toBe('');
    expect(auth.authenticateSession).not.toHaveBeenCalled();
  });

  it('rejects session refresh without a session cookie', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/refresh');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'Forbidden',
      message: 'Missing session.',
    } satisfies ErrorPayload);
  });

  it('rejects invalid authorization callbacks before touching Keycloak', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/callback?code=code-1&state=state-1');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Bad Request',
      message: 'Invalid authorization state.',
    } satisfies ErrorPayload);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('cacic_voto_oauth_state=;')]),
    );
    expect(auth.consumeAuthorizationState).not.toHaveBeenCalled();
  });

  it('logs out anonymous sessions without touching stored sessions', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').send({});

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ logoutUrl: 'https://sso.example/logout', refreshTokenRevoked: false });
    expect(auth.getSessionLogoutInput).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
  });

  it.each(protectedRouteCases)('requires authentication for $method $route', async (route) => {
    const res = await requestRoute(app, route);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      message: 'Missing authenticated session.',
    } satisfies ErrorPayload);
  });

  it('evaluates permissions for authenticated sessions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/permissions/evaluate')
      .set('Cookie', 'cacic_voto_session=session-1')
      .send({ permissions: ['poll#read', 'poll#create'] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ permissions: ['poll#read'] });
    expect(auth.authenticateSession).toHaveBeenCalledWith('session-1', []);
    expect(auth.evaluateSessionPermissions).toHaveBeenCalledWith('session-1', ['poll#read', 'poll#create']);
  });

  it('serves authenticated public poll, admin poll, image, and slate routes through the Nest HTTP boundary', async () => {
    pollImages.getPollImage.mockResolvedValue({
      stream: Readable.from([Buffer.from('image')]),
      contentLength: 5,
      contentType: 'image/avif',
    });
    const authenticated = () => request(app.getHttpServer()).get('/api/polls/poll-1').set('Cookie', 'cacic_voto_session=session-1');

    await expect(authenticated()).resolves.toMatchObject({ status: 200, body: expect.objectContaining({ id: 'poll-1' }) });
    await expect(
      request(app.getHttpServer()).get('/api/polls/poll-1/responses/me').set('Cookie', 'cacic_voto_session=session-1'),
    ).resolves.toMatchObject({ status: 200, body: expect.objectContaining({ hasSubmitted: false }) });
    await expect(
      request(app.getHttpServer()).get('/api/polls/poll-1/images/image-1').set('Cookie', 'cacic_voto_session=session-1'),
    ).resolves.toMatchObject({ status: 200, headers: expect.objectContaining({ 'content-type': 'image/avif' }) });
    await expect(
      request(app.getHttpServer()).get('/api/polls/poll-1/cacic-election/slates').set('Cookie', 'cacic_voto_session=session-1'),
    ).resolves.toMatchObject({ status: 200, body: [expect.objectContaining({ id: 'slate-1' })] });
    await expect(
      request(app.getHttpServer()).put('/api/polls/poll-1/cacic-election/slates/me').set('Cookie', 'cacic_voto_session=session-1').send(createSlateRequest()),
    ).resolves.toMatchObject({ status: 200, body: expect.objectContaining({ id: 'slate-1' }) });
    await expect(
      request(app.getHttpServer()).get('/api/admin/polls/poll-1/cacic-election/slates').set('Cookie', 'cacic_voto_session=session-1'),
    ).resolves.toMatchObject({ status: 200, body: [expect.objectContaining({ id: 'slate-1' })] });
    await expect(
      request(app.getHttpServer())
        .patch('/api/admin/polls/poll-1/cacic-election/slates/slate-1/enabled')
        .set('Cookie', 'cacic_voto_session=session-1')
        .send({ enabled: false }),
    ).resolves.toMatchObject({ status: 200, body: expect.objectContaining({ enabled: false }) });

    expect(polls.getPublishedPoll).toHaveBeenCalledWith('poll-1', expect.objectContaining({ sub: 'user-1' }));
    expect(polls.submitCacicElectionSlate).toHaveBeenCalledWith(
      'poll-1',
      createSlateRequest(),
      expect.objectContaining({ sub: 'user-1' }),
    );
    expect(polls.updateCacicElectionSlateEnabled).toHaveBeenCalledWith('poll-1', 'slate-1', { enabled: false });
  });

  it('publishes the OpenAPI contract for auth, public poll, and admin poll routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json');
    const body = res.body as OpenApiDocument;

    expect(res.status).toBe(200);
    expect(body.info).toMatchObject({
      title: 'CACiC Voto API',
      version: '1.0',
    });
    expect(Object.values(body.components?.securitySchemes ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'cookie',
          name: 'cacic_voto_session',
          type: 'apiKey',
        }),
      ]),
    );
    expect(body.paths).toEqual(
      expect.objectContaining({
        '/api/admin/polls': expect.any(Object),
        '/api/admin/polls/{id}/cacic-election/voter-enrollments.txt': expect.any(Object),
        '/api/admin/polls/{id}/eligibility-enrollments/import': expect.any(Object),
        '/api/admin/polls/{id}/cacic-election/slates': expect.any(Object),
        '/api/admin/polls/{id}/cacic-election/slates/{slateId}/enabled': expect.any(Object),
        '/api/admin/polls/{id}/results': expect.any(Object),
        '/api/auth/me': expect.any(Object),
        '/api/auth/permissions/evaluate': expect.any(Object),
        '/api/polls': expect.any(Object),
        '/api/polls/{id}/cacic-election/slates/me': expect.any(Object),
        '/api/polls/{id}/responses': expect.any(Object),
      }),
    );
  });
});

function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CACiC Voto API')
    .setDescription('REST API for authentication, poll management, public polls, and vote submissions.')
    .setVersion('1.0')
    .addCookieAuth('cacic_voto_session')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}

function requestRoute(app: INestApplication, { body, method, url }: RouteCase) {
  const server = app.getHttpServer();

  switch (method) {
    case 'delete':
      return request(server).delete(url);
    case 'get':
      return request(server).get(url);
    case 'patch':
      return request(server).patch(url).send(body);
    case 'post':
      return request(server).post(url).send(body);
    case 'put':
      return request(server).put(url).send(body);
  }
}

function createAuthMock(): AuthMock {
  return {
    authenticateSession: jest.fn(),
    buildAuthorizationUrl: jest.fn(),
    clearSession: jest.fn(),
    consumeAuthorizationState: jest.fn(),
    createSession: jest.fn(),
    evaluateSessionPermissions: jest.fn(),
    exchangeCodeForTokens: jest.fn(),
    getPostLoginRedirectUri: jest.fn(),
    getSessionLogoutInput: jest.fn(),
    logout: jest.fn(),
    refreshSession: jest.fn(),
  } as AuthMock;
}

function createPollsMock(): PollsMock {
  return {
    addEligibilityEnrollments: jest.fn(),
    assertPublishedDirectLinkPollReadable: jest.fn(),
    assertPublishedPollReadable: jest.fn(),
    clearEligibilityEnrollments: jest.fn(),
    createAdminCacicElectionSlate: jest.fn(),
    createPoll: jest.fn(),
    deleteCacicElectionSlate: jest.fn(),
    deleteEligibilityEnrollment: jest.fn(),
    deletePoll: jest.fn(),
    exportCacicElectionVoterEnrollments: jest.fn(),
    getAdminPoll: jest.fn(),
    getAdminPollResults: jest.fn(),
    getDirectLinkPublicPollResults: jest.fn(),
    getDirectLinkUserResponseState: jest.fn(),
    getMyCacicElectionSlate: jest.fn(),
    getPublishedPoll: jest.fn(),
    getPublishedPollByDirectLink: jest.fn(),
    getPublicPollResults: jest.fn(),
    getUserResponseState: jest.fn(),
    importEligibilityEnrollments: jest.fn(),
    listAdminPolls: jest.fn(),
    listAdminCacicElectionSlates: jest.fn(),
    listEligibilityEnrollments: jest.fn(),
    listLinkableEvents: jest.fn(),
    listPublicCacicElectionSlates: jest.fn(),
    rejectCacicElectionSlate: jest.fn(),
    listPublicPolls: jest.fn(),
    streamAdminPollResults: jest.fn(),
    streamDirectLinkPublicPollResults: jest.fn(),
    streamPublicPollResults: jest.fn(),
    submitCacicElectionSlate: jest.fn(),
    submitDirectLinkResponse: jest.fn(),
    submitResponse: jest.fn(),
    updateAdminCacicElectionSlate: jest.fn(),
    updateCacicElectionSlateEnabled: jest.fn(),
    updatePoll: jest.fn(),
    updatePollStatus: jest.fn(),
  } as PollsMock;
}

function createPollImagesMock(): PollImagesMock {
  return {
    deletePollImage: jest.fn(),
    getPollImage: jest.fn(),
    uploadPollImage: jest.fn(),
  } as PollImagesMock;
}

function resetMocks(auth: AuthMock, polls: PollsMock, pollImages: PollImagesMock): void {
  jest.clearAllMocks();

  auth.authenticateSession.mockResolvedValue(createPrincipal());
  auth.buildAuthorizationUrl.mockResolvedValue({
    authorizationUrl: 'https://sso.example/auth',
    state: 'state-1',
  });
  auth.clearSession.mockResolvedValue(undefined);
  auth.consumeAuthorizationState.mockResolvedValue(undefined);
  auth.createSession.mockResolvedValue({
    expiresAt: Date.now() + 1000,
    sessionExpiresAt: Date.now() + 2000,
    sessionId: 'session-1',
  });
  auth.evaluateSessionPermissions.mockResolvedValue(['poll#read']);
  auth.exchangeCodeForTokens.mockResolvedValue({ access_token: 'access-token' });
  auth.getPostLoginRedirectUri.mockReturnValue('/polls');
  auth.getSessionLogoutInput.mockResolvedValue(null);
  auth.logout.mockResolvedValue({
    logoutUrl: 'https://sso.example/logout',
    refreshTokenRevoked: false,
  });
  auth.refreshSession.mockResolvedValue({
    expiresAt: Date.now() + 1000,
    sessionExpiresAt: Date.now() + 2000,
  });

  polls.listPublicPolls.mockResolvedValue([]);
  polls.getPublishedPollByDirectLink.mockResolvedValue(createPoll());
  polls.assertPublishedDirectLinkPollReadable.mockResolvedValue('poll-1');
  polls.getDirectLinkPublicPollResults.mockResolvedValue(createPollResults());
  polls.getDirectLinkUserResponseState.mockResolvedValue(createResponseState());
  polls.streamDirectLinkPublicPollResults.mockReturnValue(of({ data: { pollId: 'poll-1' } }));
  polls.submitDirectLinkResponse.mockResolvedValue(createPollResponse());
  polls.getPublishedPoll.mockResolvedValue(createPoll());
  polls.assertPublishedPollReadable.mockResolvedValue(undefined);
  polls.getPublicPollResults.mockResolvedValue(createPollResults());
  polls.getUserResponseState.mockResolvedValue(createResponseState());
  polls.streamPublicPollResults.mockReturnValue(of({ data: { pollId: 'poll-1' } }));
  polls.submitResponse.mockResolvedValue(createPollResponse());
  polls.listPublicCacicElectionSlates.mockResolvedValue([createSlate()]);
  polls.getMyCacicElectionSlate.mockResolvedValue(createAdminSlate());
  polls.submitCacicElectionSlate.mockResolvedValue(createSlate());
  polls.listAdminPolls.mockResolvedValue([]);
  polls.listLinkableEvents.mockResolvedValue([]);
  polls.listEligibilityEnrollments.mockResolvedValue(createEligibilityList());
  polls.addEligibilityEnrollments.mockResolvedValue(createEligibilityImportResult());
  polls.importEligibilityEnrollments.mockResolvedValue(createEligibilityImportResult());
  polls.clearEligibilityEnrollments.mockResolvedValue(createEligibilityList());
  polls.deleteEligibilityEnrollment.mockResolvedValue(undefined);
  polls.getAdminPollResults.mockResolvedValue(createPollResults());
  polls.exportCacicElectionVoterEnrollments.mockResolvedValue('24123456');
  polls.streamAdminPollResults.mockReturnValue(of({ data: { pollId: 'poll-1' } }));
  polls.listAdminCacicElectionSlates.mockResolvedValue([createAdminSlate()]);
  polls.createAdminCacicElectionSlate.mockResolvedValue(createAdminSlate());
  polls.updateAdminCacicElectionSlate.mockResolvedValue(createAdminSlate());
  polls.rejectCacicElectionSlate.mockResolvedValue(createAdminSlate({ status: 'rejected', rejectionReason: 'Documentos incompletos.' }));
  polls.updateCacicElectionSlateEnabled.mockImplementation(async (_pollId, _slateId, input) =>
    createAdminSlate({ enabled: input.enabled }),
  );
  polls.deleteCacicElectionSlate.mockResolvedValue(undefined);
  polls.getAdminPoll.mockResolvedValue(createPoll());
  polls.createPoll.mockResolvedValue(createPoll());
  polls.updatePoll.mockResolvedValue(createPoll());
  polls.updatePollStatus.mockResolvedValue(createPoll());
  polls.deletePoll.mockResolvedValue(undefined);

  pollImages.getPollImage.mockRejectedValue(new Error('Unexpected image read in integration test.'));
  pollImages.uploadPollImage.mockResolvedValue(createPollImage());
  pollImages.deletePollImage.mockResolvedValue(undefined);
}

function createPrincipal(): AuthenticatedPrincipal {
  return {
    claims: {},
    email: 'ada@example.com',
    oidcScopes: ['openid'],
    permissionSet: new Set(['poll#read']),
    permissions: ['poll#read'],
    preferredUsername: 'ada',
    roleSet: new Set(['admin']),
    roles: ['admin'],
    scopes: ['openid'],
    sub: 'user-1',
    token: 'access-token',
  };
}

function createSlateRequest(): SubmitCacicElectionSlateRequest {
  return {
    name: 'Chapa Integração',
    members: [
      {
        fullName: 'Ana Presidente',
        enrollmentNumber: '26123456',
        role: 'president',
        isRepresentative: true,
        identifierType: 'email',
        identifierValue: 'ana@example.com',
      },
      {
        fullName: 'Bia Vice',
        enrollmentNumber: '25123456',
        role: 'vicePresident',
        isRepresentative: false,
        identifierType: 'email',
        identifierValue: 'bia@example.com',
      },
      {
        fullName: 'Caio Financeiro',
        enrollmentNumber: '24123456',
        role: 'financialDirector',
        isRepresentative: false,
        identifierType: 'phone',
        identifierValue: '18999990001',
      },
      {
        fullName: 'Duda Comunicação',
        enrollmentNumber: '23123456',
        role: 'communicationDirector',
        isRepresentative: false,
        identifierType: 'email',
        identifierValue: 'duda@example.com',
      },
      {
        fullName: 'Eva Eventos',
        enrollmentNumber: '22123456',
        role: 'eventsDirector',
        isRepresentative: false,
        identifierType: 'cpf',
        identifierValue: '12345678901',
      },
      {
        fullName: 'Fabio Relações',
        enrollmentNumber: '21123456',
        role: 'publicRelationsDirector',
        isRepresentative: false,
        identifierType: 'email',
        identifierValue: 'fabio@example.com',
      },
    ],
  };
}

function createSlate(overrides: Partial<CacicElectionSlate> = {}): CacicElectionSlate {
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
    pollId: 'poll-1',
    reviewedAt: '2026-06-21T12:00:00.000Z',
    status: 'approved',
    submissionSource: 'public',
    submittedAt: '2026-06-21T12:00:00.000Z',
    submittedBy: {
      email: 'ana@example.com',
      name: 'Ana Presidente',
      preferredUsername: 'ana',
      userId: 'user-1',
    },
    ...overrides,
  };
}

function createAdminSlate(overrides: Partial<AdminCacicElectionSlate> = {}): AdminCacicElectionSlate {
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

function createPoll(): Poll {
  return {
    allowMultipleResponses: false,
    allowResponseEditing: false,
    createdAt: '2026-06-21T12:00:00.000Z',
    directLinkEnabled: false,
    elements: [],
    id: 'poll-1',
    mode: 'regular',
    requireVerifiedUnespRole: false,
    resultsLive: false,
    resultsPublic: false,
    status: 'published',
    title: 'Votação de integração',
    updatedAt: '2026-06-21T12:00:00.000Z',
    voterEligibilitySource: 'authenticatedUsers',
    votingStyle: 'secret',
  };
}

function createPollResponse(): PollResponse {
  return {
    answers: [],
    id: 'response-1',
    pollId: 'poll-1',
    submittedAt: '2026-06-21T12:00:00.000Z',
  };
}

function createResponseState(): PollUserResponseState {
  return {
    canEdit: false,
    canSubmitAnother: false,
    hasSubmitted: false,
  };
}

function createPollResults(): PollResults {
  return {
    anonymous: false,
    answersReleased: true,
    pollId: 'poll-1',
    responseCount: 0,
    responses: [],
  };
}

function createEligibilityList(): PollEligibilityEnrollmentList {
  return {
    entries: [],
    totalCount: 0,
  };
}

function createEligibilityImportResult(): PollEligibilityEnrollmentImportResult {
  return {
    ...createEligibilityList(),
    createdCount: 0,
    duplicateCount: 0,
    existingCount: 0,
    invalidCount: 0,
    replacedCount: 0,
  };
}

function createPollImage(): PollImage {
  return {
    height: 200,
    id: 'image-1',
    url: '/api/polls/poll-1/images/image-1',
    width: 200,
  };
}
