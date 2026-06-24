import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AUTH_SESSION_COOKIE_NAME, AUTH_STATE_COOKIE_NAME } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthenticatedPrincipal, AuthenticatedRequest } from './auth.types';
import { KeycloakAuthService } from './keycloak-auth.service';

type AuthMock = jest.Mocked<
  Pick<
    KeycloakAuthService,
    | 'buildAuthorizationUrl'
    | 'consumeAuthorizationState'
    | 'exchangeCodeForTokens'
    | 'createSession'
    | 'getPostLoginRedirectUri'
    | 'refreshSession'
    | 'getSessionLogoutInput'
    | 'clearSession'
    | 'logout'
    | 'evaluateSessionPermissions'
  >
>;

type ResponseMock = {
  cookie: jest.Mock<void, [string, string, Record<string, unknown>]>;
  clearCookie: jest.Mock<void, [string, Record<string, unknown>]>;
  redirect: jest.Mock<void, [string]>;
};

type AuthControllerInternals = {
  resolveReturnTo(returnTo?: string): string | undefined;
  getFailedAuthorizationRedirectUri(): string;
};

function createResponse(): ResponseMock {
  return {
    cookie: jest.fn<void, [string, string, Record<string, unknown>]>(),
    clearCookie: jest.fn<void, [string, Record<string, unknown>]>(),
    redirect: jest.fn<void, [string]>(),
  };
}

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    protocol: 'http',
    secure: false,
    headers: {
      host: 'localhost:3000',
    },
    get: jest.fn((name: string) => (name.toLowerCase() === 'host' ? 'localhost:3000' : undefined)),
    ...overrides,
  } as Request;
}

function createUser(): AuthenticatedPrincipal {
  return {
    sub: 'user-1',
    preferredUsername: 'ada',
    email: 'ada@example.com',
    roles: ['admin'],
    permissions: ['poll#read'],
    scopes: ['openid'],
    oidcScopes: ['openid'],
    claims: { name: 'Ada' },
    token: 'token',
    roleSet: new Set(['admin']),
    permissionSet: new Set(['poll#read']),
  };
}

describe('AuthController', () => {
  const originalEnv = process.env;
  let auth: AuthMock;
  let controller: AuthController;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    process.env = {
      ...originalEnv,
      KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS: 'https://api.example, bad-origin',
      KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS: 'https://app.example',
      KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS: 'https://app.example',
    };
    auth = {
      buildAuthorizationUrl: jest.fn().mockResolvedValue({
        authorizationUrl: 'https://sso.example/auth',
        state: 'state-1',
      }),
      consumeAuthorizationState: jest.fn().mockResolvedValue({
        redirectUri: 'https://api.example/api/auth/callback',
        returnTo: 'https://app.example/polls',
      }),
      exchangeCodeForTokens: jest.fn().mockResolvedValue({ access_token: 'access' }),
      createSession: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        expiresAt: Date.now() + 1000,
        sessionExpiresAt: Date.now() + 2000,
      }),
      getPostLoginRedirectUri: jest.fn().mockReturnValue('https://app.example/polls'),
      refreshSession: jest.fn().mockResolvedValue({
        expiresAt: Date.now() + 1000,
        sessionExpiresAt: Date.now() + 2000,
      }),
      getSessionLogoutInput: jest.fn().mockResolvedValue({ refreshToken: 'refresh', idTokenHint: 'id-token' }),
      clearSession: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue({ refreshTokenRevoked: true, logoutUrl: 'https://sso.example/logout' }),
      evaluateSessionPermissions: jest.fn().mockResolvedValue(['poll#read']),
    };
    controller = new AuthController(auth as unknown as KeycloakAuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds login URLs and stores authorization state cookies', async () => {
    const response = createResponse();
    const request = createRequest({
      secure: true,
      headers: { host: 'localhost:3000' },
    });

    await expect(
      controller.getLoginUrl(request, response as unknown as Response, '/polls', 'openid email', 'login'),
    ).resolves.toEqual({
      authorizationUrl: 'https://sso.example/auth',
    });

    expect(auth.buildAuthorizationUrl).toHaveBeenCalledWith({
      redirectUri: 'http://localhost:3000/api/auth/callback',
      returnTo: '/polls',
      scope: 'openid email',
      prompt: 'login',
    });
    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_STATE_COOKIE_NAME,
      'state-1',
      expect.objectContaining({ httpOnly: true, secure: true, path: '/api/auth/callback' }),
    );
  });

  it('redirects to Keycloak for browser login', async () => {
    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'internal.local',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.example',
      },
    });

    await controller.redirectToLogin(request, response as unknown as Response, 'https://app.example/dashboard');

    expect(auth.buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'https://api.example/api/auth/callback',
        returnTo: 'https://app.example/dashboard',
      }),
    );
    expect(response.redirect).toHaveBeenCalledWith('https://sso.example/auth');
  });

  it('completes callbacks, sets session cookies, and redirects to the post-login URL', async () => {
    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
      },
    });

    await controller.callback(request, response as unknown as Response, 'code-1', undefined, 'state-1');

    expect(response.clearCookie).toHaveBeenCalledWith(
      AUTH_STATE_COOKIE_NAME,
      expect.objectContaining({ path: '/api/auth/callback' }),
    );
    expect(auth.exchangeCodeForTokens).toHaveBeenCalledWith(
      'code-1',
      expect.objectContaining({ returnTo: 'https://app.example/polls' }),
      'http://localhost:3000/api/auth/callback',
    );
    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      'session-1',
      expect.objectContaining({ expires: new Date(Date.now() + 2000), maxAge: 2000 }),
    );
    expect(response.redirect).toHaveBeenCalledWith('https://app.example/polls');
  });

  it('redirects failed silent callbacks with sso=none', async () => {
    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
      },
    });
    auth.consumeAuthorizationState.mockResolvedValueOnce({ returnTo: '/polls', prompt: 'none' });
    auth.getPostLoginRedirectUri.mockReturnValueOnce('/polls');

    await controller.callback(request, response as unknown as Response, undefined, 'login_required', 'state-1');

    expect(response.redirect).toHaveBeenCalledWith('/polls?sso=none');
  });

  it('redirects failed interactive callbacks without adding silent-login markers', async () => {
    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
      },
    });
    auth.consumeAuthorizationState.mockResolvedValueOnce({ returnTo: 'not a url', prompt: 'login' });
    auth.getPostLoginRedirectUri.mockReturnValueOnce('not a url');

    await controller.callback(request, response as unknown as Response, undefined, 'access_denied', 'state-1');

    expect(response.redirect).toHaveBeenCalledWith('not a url');
  });

  it('rejects invalid callback states and missing authorization codes', async () => {
    const response = createResponse();

    await expect(
      controller.callback(createRequest(), response as unknown as Response, 'code-1', undefined, 'state-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.callback(
        createRequest({ headers: { host: 'localhost:3000', cookie: `${AUTH_STATE_COOKIE_NAME}=state-1` } }),
        response as unknown as Response,
        undefined,
        undefined,
        'state-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    auth.consumeAuthorizationState.mockResolvedValueOnce(undefined);
    await expect(
      controller.callback(
        createRequest({ headers: { host: 'localhost:3000', cookie: `${AUTH_STATE_COOKIE_NAME}=state-1` } }),
        response as unknown as Response,
        'code',
        undefined,
        'state-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns public user data or null', () => {
    expect(controller.getMe({ user: createUser() } as AuthenticatedRequest)).toEqual({
      sub: 'user-1',
      preferredUsername: 'ada',
      email: 'ada@example.com',
      roles: ['admin'],
      permissions: ['poll#read'],
      scopes: ['openid'],
      oidcScopes: ['openid'],
      claims: { name: 'Ada' },
    });
    expect(controller.getMe({} as AuthenticatedRequest)).toBeNull();
  });

  it('refreshes sessions from parsed or raw cookies', async () => {
    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_SESSION_COOKIE_NAME}=session%3D1`,
      },
    });

    await expect(controller.refresh(request, response as unknown as Response)).resolves.toMatchObject({
      sessionExpiresAt: Date.now() + 2000,
    });
    expect(auth.refreshSession).toHaveBeenCalledWith('session=1');
    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      'session=1',
      expect.objectContaining({ path: '/', maxAge: 2000 }),
    );

    await expect(controller.refresh(createRequest(), response as unknown as Response)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('prefers parsed cookies and scans raw cookie headers safely', async () => {
    const response = createResponse();

    await controller.refresh(
      createRequest({
        cookies: { [AUTH_SESSION_COOKIE_NAME]: 'parsed-session' },
        headers: { host: 'localhost:3000', 'x-forwarded-proto': ['https'] },
      } as Partial<Request>),
      response as unknown as Response,
    );
    expect(auth.refreshSession).toHaveBeenLastCalledWith('parsed-session');
    expect(response.cookie).toHaveBeenLastCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      'parsed-session',
      expect.objectContaining({ secure: true }),
    );

    await controller.refresh(
      createRequest({
        headers: {
          host: 'localhost:3000',
          cookie: `theme=dark; ${AUTH_SESSION_COOKIE_NAME}=raw-session`,
        },
      }),
      response as unknown as Response,
    );
    expect(auth.refreshSession).toHaveBeenLastCalledWith('raw-session');

    await expect(
      controller.refresh(
        createRequest({ headers: { host: 'localhost:3000', cookie: 'theme=dark' } }),
        response as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('logs out current sessions and clears cookies', async () => {
    const response = createResponse();
    const request = createRequest({
      secure: true,
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_SESSION_COOKIE_NAME}=session-1`,
      },
    });

    await expect(
      controller.logout(request, response as unknown as Response, { postLogoutRedirectUri: 'https://app.example/login' }),
    ).resolves.toEqual({ refreshTokenRevoked: true, logoutUrl: 'https://sso.example/logout' });

    expect(auth.getSessionLogoutInput).toHaveBeenCalledWith('session-1');
    expect(auth.clearSession).toHaveBeenCalledWith('session-1');
    expect(response.clearCookie).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      expect.objectContaining({ secure: true, path: '/' }),
    );
    expect(auth.logout).toHaveBeenCalledWith({
      refreshToken: 'refresh',
      idTokenHint: 'id-token',
      postLogoutRedirectUri: 'https://app.example/login',
    });
  });

  it('logs out without a local session', async () => {
    const response = createResponse();

    await controller.logout(createRequest(), response as unknown as Response);

    expect(auth.getSessionLogoutInput).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
    expect(auth.logout).toHaveBeenCalledWith({
      refreshToken: undefined,
      idTokenHint: undefined,
      postLogoutRedirectUri: undefined,
    });
  });

  it('evaluates permissions for authenticated requests', async () => {
    await expect(
      controller.evaluatePermissions({ sessionId: 'session-1' } as AuthenticatedRequest, {
        permissions: ['poll#read'],
      }),
    ).resolves.toEqual({ permissions: ['poll#read'] });

    await expect(
      controller.evaluatePermissions({} as AuthenticatedRequest, { permissions: ['poll#read'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsafe redirect and callback URLs', async () => {
    const response = createResponse();

    process.env.KEYCLOAK_REDIRECT_URI = 'https://api.example/not-callback';
    controller = new AuthController(auth as unknown as KeycloakAuthService);
    await expect(controller.getLoginUrl(createRequest(), response as unknown as Response)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    process.env.KEYCLOAK_REDIRECT_URI = 'https://evil.example/api/auth/callback';
    controller = new AuthController(auth as unknown as KeycloakAuthService);
    await expect(controller.getLoginUrl(createRequest(), response as unknown as Response)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    delete process.env.KEYCLOAK_REDIRECT_URI;
    controller = new AuthController(auth as unknown as KeycloakAuthService);
    await expect(
      controller.getLoginUrl(createRequest(), response as unknown as Response, 'ftp://app.example/path'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getLoginUrl(createRequest(), response as unknown as Response, 'https://evil.example/path'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.logout(createRequest(), response as unknown as Response, { postLogoutRedirectUri: 'https://evil.example' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes empty redirect inputs and rejects malformed URLs', async () => {
    const response = createResponse();

    await controller.getLoginUrl(createRequest(), response as unknown as Response, '   ');
    expect(auth.buildAuthorizationUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        returnTo: undefined,
      }),
    );

    await expect(
      controller.getLoginUrl(createRequest(), response as unknown as Response, 'http://[::1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores blank allowed-origin entries and falls back to raw silent-login redirects when they cannot be parsed', async () => {
    process.env.KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS = ' , https://api.example';
    process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS = ' , https://app.example';
    process.env.KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS = ' , https://app.example';
    controller = new AuthController(auth as unknown as KeycloakAuthService);

    const response = createResponse();
    const request = createRequest({
      headers: {
        host: 'localhost:3000',
        cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
      },
    });
    auth.consumeAuthorizationState.mockResolvedValueOnce({ returnTo: 'http://[::1', prompt: 'none' });
    auth.getPostLoginRedirectUri.mockReturnValueOnce('http://[::1');

    await controller.callback(request, response as unknown as Response, undefined, 'login_required', 'state-1');

    expect(response.redirect).toHaveBeenCalledWith('http://[::1');
  });

  it('uses default allowed origins, forwarded-header arrays, and absolute silent-login redirect markers', async () => {
    delete process.env.KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS;
    delete process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS;
    delete process.env.KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS;
    controller = new AuthController(auth as unknown as KeycloakAuthService);

    const loginResponse = createResponse();
    await controller.getLoginUrl(
      createRequest({
        headers: {
          host: 'internal.local',
          'x-forwarded-proto': ['https'],
          'x-forwarded-host': ['voto.cacic.dev.br'],
        },
      }),
      loginResponse as unknown as Response,
      '/polls',
    );
    expect(auth.buildAuthorizationUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        redirectUri: 'https://voto.cacic.dev.br/api/auth/callback',
      }),
    );

    const interactiveCallbackResponse = createResponse();
    auth.consumeAuthorizationState.mockResolvedValueOnce({ returnTo: '/polls' });
    auth.getPostLoginRedirectUri.mockReturnValueOnce('/polls');

    await controller.callback(
      createRequest({
        headers: {
          host: 'localhost:3000',
          cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
        },
      }),
      interactiveCallbackResponse as unknown as Response,
      undefined,
      'access_denied',
      'state-1',
    );
    expect(interactiveCallbackResponse.redirect).toHaveBeenCalledWith('/polls');

    const callbackResponse = createResponse();
    auth.consumeAuthorizationState.mockResolvedValueOnce({ returnTo: 'https://voto.cacic.dev.br/polls', prompt: 'none' });
    auth.getPostLoginRedirectUri.mockReturnValueOnce('https://voto.cacic.dev.br/polls');

    await controller.callback(
      createRequest({
        headers: {
          host: 'localhost:3000',
          cookie: `${AUTH_STATE_COOKIE_NAME}=state-1`,
        },
      }),
      callbackResponse as unknown as Response,
      undefined,
      'login_required',
      'state-1',
    );

    expect(callbackResponse.redirect).toHaveBeenCalledWith('https://voto.cacic.dev.br/polls?sso=none');
  });

  it('covers internal redirect fallbacks used by controller decorators', () => {
    const controllerInternals = controller as unknown as AuthControllerInternals;
    auth.getPostLoginRedirectUri.mockReturnValueOnce('/login');

    expect(controllerInternals.resolveReturnTo()).toBeUndefined();
    expect(controllerInternals.getFailedAuthorizationRedirectUri()).toBe('/login');
  });
});
