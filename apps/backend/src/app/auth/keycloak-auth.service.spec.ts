import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { AuthSessionStoreService } from './auth-session-store.service';
import { AuthorizationStateService } from './authorization-state.service';
import { AuthSession, AuthorizationState } from './auth.types';
import { KeycloakAuthService } from './keycloak-auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

type SessionStoreMock = jest.Mocked<
  Pick<
    AuthSessionStoreService,
    'get' | 'set' | 'delete' | 'acquireRefreshLock' | 'releaseRefreshLock' | 'waitForRefreshLockRelease'
  >
>;

type AuthorizationStateMock = jest.Mocked<
  Pick<AuthorizationStateService, 'create' | 'consume' | 'getAuthorizationRedirectUri' | 'getPostLoginRedirectUri'>
>;

type PrismaMock = {
  user: {
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

function tokenWithClaims(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.signature`;
}

function createSessionStoreMock(): SessionStoreMock {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    acquireRefreshLock: jest.fn().mockResolvedValue(true),
    releaseRefreshLock: jest.fn().mockResolvedValue(undefined),
    waitForRefreshLockRelease: jest.fn().mockResolvedValue(undefined),
  };
}

function createAuthorizationStateMock(): AuthorizationStateMock {
  return {
    create: jest.fn().mockResolvedValue('state-1'),
    consume: jest.fn().mockResolvedValue({ returnTo: '/polls' }),
    getAuthorizationRedirectUri: jest.fn((state?: AuthorizationState) => state?.redirectUri),
    getPostLoginRedirectUri: jest.fn((state?: AuthorizationState) => state?.returnTo ?? '/'),
  };
}

function createPrismaMock(): PrismaMock {
  return {
    user: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('KeycloakAuthService', () => {
  const originalEnv = process.env;
  let sessions: SessionStoreMock;
  let authorizationState: AuthorizationStateMock;
  let prisma: PrismaMock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    process.env = {
      ...originalEnv,
      KEYCLOAK_REALM_URL: 'https://sso.example/realms/cacic/',
      KEYCLOAK_CLIENT_ID: 'voto-client',
      KEYCLOAK_REDIRECT_URI: 'https://app.example/api/auth/callback',
      KEYCLOAK_POST_LOGOUT_REDIRECT_URI: 'https://app.example/login',
      KEYCLOAK_INTROSPECTION_CACHE_TTL_MS: '60000',
    };
    delete process.env.KEYCLOAK_CLIENT_SECRET;
    delete process.env.KEYCLOAK_IDP_HINT;
    sessions = createSessionStoreMock();
    authorizationState = createAuthorizationStateMock();
    prisma = createPrismaMock();
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(): KeycloakAuthService {
    return new KeycloakAuthService(
      sessions as unknown as AuthSessionStoreService,
      authorizationState as unknown as AuthorizationStateService,
      prisma as unknown as PrismaService,
    );
  }

  function mockUserInfo(claims: Record<string, unknown>): void {
    mockedAxios.get.mockResolvedValue({ data: claims });
  }

  it('builds authorization URLs from default realm/client config and omitted options', async () => {
    delete process.env.KEYCLOAK_REALM_URL;
    delete process.env.KEYCLOAK_CLIENT_ID;
    delete process.env.KEYCLOAK_IDP_HINT;
    const service = createService();

    await expect(service.buildAuthorizationUrl()).resolves.toMatchObject({
      state: 'state-1',
      authorizationUrl: expect.stringContaining('client_id=cacic-voto'),
    });
    expect(authorizationState.create).toHaveBeenLastCalledWith({
      redirectUri: 'https://app.example/api/auth/callback',
      returnTo: undefined,
      state: undefined,
      prompt: undefined,
    });

    await service.buildAuthorizationUrl({ redirectUri: 'https://override.example/api/auth/callback' });
    expect(authorizationState.create).toHaveBeenLastCalledWith({
      redirectUri: 'https://override.example/api/auth/callback',
      returnTo: undefined,
      state: undefined,
      prompt: undefined,
    });
  });

  it('builds authorization URLs with stored state and optional identity provider hints', async () => {
    process.env.KEYCLOAK_IDP_HINT = 'cacic-sso';
    const service = createService();

    await expect(
      service.buildAuthorizationUrl({
        returnTo: '/polls',
        scope: 'openid email',
        prompt: 'none',
        state: 'external-state',
      }),
    ).resolves.toEqual({
      state: 'state-1',
      authorizationUrl:
        'https://sso.example/realms/cacic/protocol/openid-connect/auth?client_id=voto-client&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fauth%2Fcallback&response_type=code&scope=openid+email&state=state-1&prompt=none&kc_idp_hint=cacic-sso',
    });
    expect(authorizationState.create).toHaveBeenCalledWith({
      redirectUri: 'https://app.example/api/auth/callback',
      returnTo: '/polls',
      state: 'external-state',
      prompt: 'none',
    });
  });

  it('rejects authorization URL creation without a redirect URI', async () => {
    delete process.env.KEYCLOAK_REDIRECT_URI;
    const service = createService();

    await expect(service.buildAuthorizationUrl()).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('exchanges authorization codes for tokens and includes client secrets when configured', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'access' } });
    authorizationState.getAuthorizationRedirectUri.mockReturnValueOnce('https://state.example/callback');

    await expect(
      service.exchangeCodeForTokens('code-1', { redirectUri: 'https://state.example/callback' }, 'https://fallback'),
    ).resolves.toEqual({ access_token: 'access' });

    const payload = mockedAxios.post.mock.calls[0][1] as string;
    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://sso.example/realms/cacic/protocol/openid-connect/token');
    expect(payload).toContain('grant_type=authorization_code');
    expect(payload).toContain('client_secret=secret');
    expect(payload).toContain('redirect_uri=https%3A%2F%2Fstate.example%2Fcallback');
  });

  it('wraps token exchange and refresh failures', async () => {
    const service = createService();
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { error: 'invalid_grant' } } });
    await expect(service.exchangeCodeForTokens('bad-code')).rejects.toBeInstanceOf(UnauthorizedException);

    mockedAxios.post.mockRejectedValueOnce({});
    await expect(service.exchangeCodeForTokens('bad-code')).rejects.toBeInstanceOf(UnauthorizedException);

    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValueOnce(new Error('network'));
    await expect(service.exchangeCodeForTokens('bad-code')).rejects.toBeInstanceOf(UnauthorizedException);

    mockedAxios.post.mockRejectedValueOnce(new Error('network'));
    await expect(service.refreshAccessToken('refresh')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes access tokens', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'new-access' } });

    await expect(service.refreshAccessToken('refresh')).resolves.toEqual({ access_token: 'new-access' });
    expect(mockedAxios.post.mock.calls[0][1]).toContain('grant_type=refresh_token');
    expect(mockedAxios.post.mock.calls[0][1]).toContain('client_secret=secret');
  });

  it('creates sessions, derives expiration, and syncs principals from userinfo claims', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      exp: Math.floor(Date.now() / 1000) + 120,
      realm_access: { roles: ['voter'] },
      resource_access: { voting: { roles: ['poll-admin'] } },
      scope: 'openid profile',
    });
    mockUserInfo({
      sub: 'user-1',
      preferred_username: 'ada',
      email: 'ada@example.com',
      given_name: 'Ada',
      family_name: 'Lovelace',
      permissions: [{ rsname: 'poll', scopes: ['read'] }],
    });

    await expect(service.createSession({ access_token: accessToken, refresh_token: 'refresh', id_token: 'id' })).resolves.toEqual({
      sessionId: expect.any(String),
      expiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 3600000,
    });

    expect(sessions.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accessToken,
        refreshToken: 'refresh',
        idTokenHint: 'id',
        accessTokenExpiresAt: Date.now() + 120000,
        sessionExpiresAt: Date.now() + 3600000,
      }),
    );
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        create: expect.objectContaining({
          id: 'user-1',
          preferredUsername: 'ada',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          roles: ['voter', 'poll-admin'],
          permissions: ['poll#read'],
        }),
      }),
    );
  });

  it('rejects session creation when token response lacks an access token', async () => {
    await expect(createService().createSession({ refresh_token: 'refresh' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('authenticates sessions, refreshes near-expiry access tokens, and evaluates missing permissions', async () => {
    const service = createService();
    const oldSession: AuthSession = {
      accessToken: tokenWithClaims({ sub: 'old-user', exp: Math.floor(Date.now() / 1000) + 10 }),
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 10000,
      sessionExpiresAt: Date.now() + 600000,
    };
    const refreshedToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValueOnce(oldSession).mockResolvedValueOnce(oldSession);
    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: refreshedToken, refresh_token: 'refresh-2', expires_in: 120 } })
      .mockResolvedValueOnce({ data: [{ rsname: 'poll', scopes: ['edit'] }] });
    mockedAxios.get.mockResolvedValue({
      data: {
        sub: 'user-1',
        preferred_username: 'ada',
        email: 'ada@example.com',
      },
    });

    const principal = await service.authenticateSession('session-1', ['poll#edit']);

    expect(principal.sub).toBe('user-1');
    expect(principal.permissions).toEqual(['poll#edit']);
    expect(sessions.acquireRefreshLock).toHaveBeenCalledWith('session-1', expect.any(String));
    expect(sessions.releaseRefreshLock).toHaveBeenCalledWith('session-1', expect.any(String));
    expect(sessions.set).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        accessToken: refreshedToken,
        refreshToken: 'refresh-2',
      }),
    );
  });

  it('refreshes an existing session directly', async () => {
    const service = createService();
    const oldSession: AuthSession = {
      accessToken: tokenWithClaims({ sub: 'old-user', exp: Math.floor(Date.now() / 1000) + 10 }),
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 10000,
      sessionExpiresAt: Date.now() + 600000,
    };
    const refreshedToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValue(oldSession);
    mockedAxios.post.mockResolvedValue({
      data: { access_token: refreshedToken, expires_in: 120, refresh_expires_in: 600 },
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.refreshSession('session-1')).resolves.toEqual({
      expiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    expect(sessions.set).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        accessToken: refreshedToken,
        refreshToken: 'refresh',
      }),
    );
  });

  it('throws for missing sessions, missing refresh tokens, and denied permissions', async () => {
    const service = createService();
    sessions.get.mockResolvedValueOnce(undefined);
    await expect(service.authenticateSession('missing')).rejects.toBeInstanceOf(UnauthorizedException);

    sessions.get.mockResolvedValueOnce(undefined);
    await expect(service.refreshSession('missing')).rejects.toBeInstanceOf(UnauthorizedException);

    sessions.get.mockResolvedValueOnce({
      accessToken: 'access',
      accessTokenExpiresAt: Date.now() - 1,
      sessionExpiresAt: Date.now() + 1000,
    });
    await expect(service.refreshSession('session-1')).rejects.toBeInstanceOf(UnauthorizedException);

    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValueOnce({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });
    mockedAxios.post.mockResolvedValue({ data: [] });
    await expect(service.authenticateSession('session-1', ['poll#delete'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses cached principals and skips permission evaluation for voting admins', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'admin-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      realm_access: { roles: ['admin'] },
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'admin-1' } });

    await expect(service.authenticateSession('session-1', ['poll#delete'])).resolves.toMatchObject({ sub: 'admin-1' });
    await expect(service.authenticateSession('session-1', ['poll#create'])).resolves.toMatchObject({ sub: 'admin-1' });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('does not treat read-only poll permission as a privileged admin bypass', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'reader-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      permissions: ['poll#read'],
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'reader-1' } });
    mockedAxios.post.mockResolvedValue({ data: [] });

    await expect(service.authenticateSession('session-1', ['poll#delete'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it('evaluates session permissions with normalization and persistence', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 120,
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });
    mockedAxios.post.mockResolvedValue({ data: [{ rsname: 'poll', scopes: ['read'] }] });

    await expect(service.evaluateSessionPermissions('session-1', [' poll#read ', '', 'poll#read', 'poll#edit'])).resolves.toEqual([
      'poll#read',
    ]);
    expect(prisma.user.upsert).toHaveBeenCalled();
  });

  it('returns already granted session permissions without Keycloak evaluation', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      permissions: ['poll#read'],
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.evaluateSessionPermissions('session-1', ['poll#read'])).resolves.toEqual(['poll#read']);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns an empty permission list without Keycloak evaluation', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 120,
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.evaluateSessionPermissions('session-1', [])).resolves.toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns all evaluated permissions for voting admins and rejects missing sessions', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'admin-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      realm_access: { roles: ['voting-admin'] },
    });
    sessions.get.mockResolvedValueOnce(undefined);
    await expect(service.evaluateSessionPermissions('missing', ['poll#read'])).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    sessions.get.mockResolvedValueOnce({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'admin-1' } });

    await expect(service.evaluateSessionPermissions('session-1', [' poll#read ', 'poll#edit'])).resolves.toEqual([
      'poll#read',
      'poll#edit',
    ]);
  });

  it('does not return privileged permissions just because poll read is granted', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({
      sub: 'reader-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      permissions: ['poll#read'],
    });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'reader-1' } });
    mockedAxios.post.mockResolvedValue({ data: [] });

    await expect(service.evaluateSessionPermissions('session-1', ['poll#read', 'poll#edit'])).resolves.toEqual([
      'poll#read',
    ]);
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it('refreshes sessions after waiting for another refresh lock holder', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken,
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() + 120000,
        sessionExpiresAt: Date.now() + 600000,
      });
    sessions.acquireRefreshLock.mockResolvedValue(false);
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'user-1' });

    expect(sessions.waitForRefreshLockRelease).toHaveBeenCalledWith('session-1');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refreshes after lock timeout with the original refresh token when the stored session lacks one', async () => {
    const service = createService();
    const refreshedToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: 'still-old',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: 'still-old',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
        idTokenHint: 'old-id',
      });
    sessions.acquireRefreshLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: refreshedToken,
        refresh_token: 'refresh-2',
        id_token: 'new-id',
        expires_in: 120,
        refresh_expires_in: 600,
      },
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'user-1' });
    expect(mockedAxios.post.mock.calls[0][1]).toContain('refresh_token=refresh');
    expect(sessions.set).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        idTokenHint: 'new-id',
      }),
    );
  });

  it('retries refresh after lock timeout and tolerates a second lock holder', async () => {
    const service = createService();
    const refreshedToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: 'still-old',
        refreshToken: 'refresh-2',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: 'still-old',
        refreshToken: 'refresh-2',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      });
    sessions.acquireRefreshLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockedAxios.post.mockResolvedValue({ data: { access_token: refreshedToken, expires_in: 120 } });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'user-1' });

    sessions.get.mockReset();
    sessions.acquireRefreshLock.mockReset();
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: refreshedToken,
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: refreshedToken,
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      });
    sessions.acquireRefreshLock.mockResolvedValue(false);
    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('throws when refresh lock wait ends with a missing session or an invalid refresh result', async () => {
    const service = createService();
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce(undefined);
    sessions.acquireRefreshLock.mockResolvedValue(false);

    await expect(service.authenticateSession('session-1')).rejects.toBeInstanceOf(UnauthorizedException);

    sessions = createSessionStoreMock();
    const serviceWithInvalidRefresh = createService();
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce(undefined);
    mockedAxios.post.mockResolvedValue({ data: {} });

    await expect(serviceWithInvalidRefresh.authenticateSession('session-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws when a second refresh-lock wait still finds no session', async () => {
    const service = createService();
    sessions.get
      .mockResolvedValueOnce({
        accessToken: 'old-access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce({
        accessToken: 'still-old',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() - 1,
        sessionExpiresAt: Date.now() + 600000,
      })
      .mockResolvedValueOnce(undefined);
    sessions.acquireRefreshLock.mockResolvedValue(false);

    await expect(service.authenticateSession('session-1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.waitForRefreshLockRelease).toHaveBeenCalledTimes(2);
  });

  it('falls back from introspection to userinfo and rejects inactive tokens', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });

    mockedAxios.post.mockRejectedValueOnce(new Error('introspection-down'));
    mockedAxios.get.mockResolvedValueOnce({ data: { sub: 'user-1' } });
    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'user-1' });

    const inactiveToken = tokenWithClaims({ sub: 'inactive-user', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValueOnce({
      accessToken: inactiveToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { active: false } });
    await expect(service.authenticateSession('session-2')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses active introspection claims when userinfo fails and rejects fully invalid tokens', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    const accessToken = tokenWithClaims({ exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { active: true, sub: 'introspected-user' } });
    mockedAxios.get.mockRejectedValueOnce(new Error('userinfo-down'));

    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({ sub: 'introspected-user' });

    const invalidToken = tokenWithClaims({ sub: 'invalid-user', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValueOnce({
      accessToken: invalidToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post.mockRejectedValueOnce(new Error('introspection-down'));
    mockedAxios.get.mockRejectedValueOnce(new Error('userinfo-down'));
    await expect(service.authenticateSession('session-2')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('merges JWT claims from introspection and treats missing active flags as userinfo-only validation', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    const introspectionJwt = tokenWithClaims({ preferred_username: 'jwt-user' });
    sessions.get.mockResolvedValueOnce({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { active: true, jwt: introspectionJwt } });
    mockedAxios.get.mockResolvedValueOnce({ data: { sub: 'user-1' } });

    await expect(service.authenticateSession('session-1')).resolves.toMatchObject({
      preferredUsername: 'jwt-user',
    });

    const userInfoOnlyToken = tokenWithClaims({ sub: 'user-2', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValueOnce({
      accessToken: userInfoOnlyToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { sub: 'ignored-without-active' } });
    mockedAxios.get.mockResolvedValueOnce({ data: { sub: 'user-2' } });

    await expect(service.authenticateSession('session-2')).resolves.toMatchObject({ sub: 'user-2' });
  });

  it('handles permission evaluation denial and transient failures as no grants', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 403 } });

    await expect(service.evaluateSessionPermissions('session-1', ['poll#read'])).resolves.toEqual([]);

    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.post.mockRejectedValueOnce({});
    await expect(service.evaluateSessionPermissions('session-1', ['poll#comment'])).resolves.toEqual([]);

    mockedAxios.isAxiosError.mockReturnValueOnce(false);
    mockedAxios.post.mockRejectedValueOnce(new Error('network'));
    await expect(service.evaluateSessionPermissions('session-1', ['poll#edit'])).resolves.toEqual([]);
  });

  it('includes client secrets when evaluating permissions', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    sessions.get.mockResolvedValue({
      accessToken,
      refreshToken: 'refresh',
      accessTokenExpiresAt: Date.now() + 120000,
      sessionExpiresAt: Date.now() + 600000,
    });
    mockedAxios.post
      .mockResolvedValueOnce({ data: { active: true, sub: 'user-1' } })
      .mockResolvedValueOnce({ data: [{ rsname: 'poll', scopes: ['read'] }] });
    mockedAxios.get.mockResolvedValue({ data: { sub: 'user-1' } });

    await expect(service.evaluateSessionPermissions('session-1', ['poll#read'])).resolves.toEqual(['poll#read']);
    expect(mockedAxios.post.mock.calls[1][1]).toContain('client_secret=secret');
  });

  it('clears sessions, reads logout input, and builds logout URLs', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    const service = createService();
    sessions.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      accessToken: 'access',
      refreshToken: 'refresh',
      idTokenHint: 'id-token',
      accessTokenExpiresAt: Date.now() + 1000,
      sessionExpiresAt: Date.now() + 2000,
    });

    await service.clearSession('session-1');
    await expect(service.getSessionLogoutInput('missing')).resolves.toBeNull();
    await expect(service.getSessionLogoutInput('session-1')).resolves.toEqual({
      refreshToken: 'refresh',
      idTokenHint: 'id-token',
    });
    expect(sessions.delete).toHaveBeenCalledWith('session-1');

    mockedAxios.post.mockResolvedValue({ data: {} });
    await expect(
      service.logout({
        refreshToken: 'refresh',
        idTokenHint: 'id-token',
        postLogoutRedirectUri: 'https://app.example/after',
      }),
    ).resolves.toEqual({
      refreshTokenRevoked: true,
      logoutUrl:
        'https://sso.example/realms/cacic/protocol/openid-connect/logout?client_id=voto-client&id_token_hint=id-token&post_logout_redirect_uri=https%3A%2F%2Fapp.example%2Fafter',
    });

    mockedAxios.post.mockRejectedValueOnce(new Error('revoke-failed'));
    await expect(service.logout({ refreshToken: 'refresh' })).resolves.toEqual({
      refreshTokenRevoked: false,
      logoutUrl:
        'https://sso.example/realms/cacic/protocol/openid-connect/logout?client_id=voto-client&post_logout_redirect_uri=https%3A%2F%2Fapp.example%2Flogin',
    });

    delete process.env.KEYCLOAK_CLIENT_SECRET;
    delete process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI;
    const serviceWithoutLogoutDefault = createService();
    await expect(serviceWithoutLogoutDefault.logout({ refreshToken: 'refresh' })).resolves.toEqual({
      refreshTokenRevoked: false,
      logoutUrl: 'https://sso.example/realms/cacic/protocol/openid-connect/logout?client_id=voto-client',
    });
  });

  it('delegates authorization-state helpers', async () => {
    const service = createService();

    await expect(service.consumeAuthorizationState('state-1')).resolves.toEqual({ returnTo: '/polls' });
    expect(service.getPostLoginRedirectUri({ returnTo: '/dashboard' })).toBe('/dashboard');
  });

  it('uses fallback expiration and cache TTL parsing when token expirations are absent', async () => {
    process.env.KEYCLOAK_INTROSPECTION_CACHE_TTL_MS = 'invalid';
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1' });
    mockUserInfo({ sub: 'user-1', name: ' Explicit Name ' });

    await service.createSession({ access_token: accessToken, expires_in: 5, refresh_expires_in: 10 });

    expect(sessions.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accessTokenExpiresAt: Date.now() + 5000,
        sessionExpiresAt: Date.now() + 10000,
      }),
    );
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: 'Explicit Name' }),
      }),
    );
  });

  it('uses default cache TTL and refresh-token JWT expiration fallbacks', async () => {
    delete process.env.KEYCLOAK_INTROSPECTION_CACHE_TTL_MS;
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 120 });
    const refreshToken = tokenWithClaims({ exp: Math.floor(Date.now() / 1000) + 240 });
    mockUserInfo({ sub: 'user-1' });

    await service.createSession({ access_token: accessToken, refresh_token: refreshToken });

    expect(sessions.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accessTokenExpiresAt: Date.now() + 120000,
        sessionExpiresAt: Date.now() + 240000,
      }),
    );
  });

  it('uses access-token fallback expiration when no token expiry data exists', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({ sub: 'user-1' });
    mockUserInfo({ sub: 'user-1' });

    await service.createSession({ access_token: accessToken });

    expect(sessions.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accessTokenExpiresAt: Date.now() + 3600000,
        sessionExpiresAt: Date.now() + 3600000,
      }),
    );
  });

  it('does not sync principals without a subject', async () => {
    const service = createService();
    const accessToken = tokenWithClaims({ exp: Math.floor(Date.now() / 1000) + 120 });
    mockUserInfo({ preferred_username: 'anonymous' });

    await service.createSession({ access_token: accessToken });

    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
