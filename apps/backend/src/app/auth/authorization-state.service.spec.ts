import { AuthorizationStateService } from './authorization-state.service';

type RedisMock = {
  set: jest.Mock<Promise<string | null>, [string, ...unknown[]]>;
  eval: jest.Mock<Promise<unknown>, [string, number, string]>;
};

function createRedisMock(): RedisMock {
  return {
    set: jest.fn<Promise<string | null>, [string, ...unknown[]]>(),
    eval: jest.fn<Promise<unknown>, [string, number, string]>(),
  };
}

describe('AuthorizationStateService', () => {
  const originalEnv = process.env;
  let redis: RedisMock;
  let service: AuthorizationStateService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KEYCLOAK_AUTH_STATE_REDIS_PREFIX: 'test:state:',
      KEYCLOAK_AUTH_STATE_TTL_SECONDS: '30',
      KEYCLOAK_POST_LOGIN_REDIRECT_URI: 'https://app.example/home',
      KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS: 'https://app.example, https://other.example, not-a-url',
    };
    redis = createRedisMock();
    service = new AuthorizationStateService(redis as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates a stored state with normalized redirect data', async () => {
    const state = await service.create({
      redirectUri: 'https://api.example/api/auth/callback',
      returnTo: 'https://other.example/dashboard?tab=1',
      state: 'external-state',
      prompt: 'none',
    });

    expect(state).toEqual(expect.any(String));
    expect(redis.set).toHaveBeenCalledWith(
      `test:state:${state}`,
      JSON.stringify({
        redirectUri: 'https://api.example/api/auth/callback',
        returnTo: 'https://other.example/dashboard?tab=1',
        state: 'external-state',
        prompt: 'none',
      }),
      'EX',
      30,
      'NX',
    );
  });

  it('allows safe relative post-login paths and rejects auth/internal or open redirects', async () => {
    await service.create({ redirectUri: 'https://api.example/api/auth/callback', returnTo: '/polls/1' });
    expect(JSON.parse(redis.set.mock.calls[0][1] as string)).toMatchObject({ returnTo: '/polls/1' });

    await service.create({ redirectUri: 'https://api.example/api/auth/callback', returnTo: '//evil.example' });
    expect(JSON.parse(redis.set.mock.calls[1][1] as string)).not.toHaveProperty('returnTo');

    await service.create({ redirectUri: 'https://api.example/api/auth/callback', returnTo: '/api/auth/login' });
    expect(JSON.parse(redis.set.mock.calls[2][1] as string)).not.toHaveProperty('returnTo');

    await service.create({ redirectUri: 'https://api.example/api/auth/callback', returnTo: 'https://evil.example' });
    expect(JSON.parse(redis.set.mock.calls[3][1] as string)).not.toHaveProperty('returnTo');

    await service.create({ redirectUri: 'https://api.example/api/auth/callback', returnTo: 'http://[::1' });
    expect(JSON.parse(redis.set.mock.calls[4][1] as string)).not.toHaveProperty('returnTo');
  });

  it('consumes, deletes, and parses stored state values atomically', async () => {
    redis.eval.mockResolvedValueOnce(
      JSON.stringify({
        redirectUri: 'https://api.example/api/auth/callback',
        returnTo: '/polls',
        state: 'external',
        prompt: 'login',
      }),
    );

    await expect(service.consume('state-1')).resolves.toEqual({
      redirectUri: 'https://api.example/api/auth/callback',
      returnTo: '/polls',
      state: 'external',
      prompt: 'login',
    });
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("get"'), 1, 'test:state:state-1');
  });

  it('returns undefined for empty, missing, non-record, or malformed stored states', async () => {
    await expect(service.consume()).resolves.toBeUndefined();

    redis.eval.mockResolvedValueOnce(null);
    await expect(service.consume('missing')).resolves.toBeUndefined();

    redis.eval.mockResolvedValueOnce('"not-record"');
    await expect(service.consume('string')).resolves.toBeUndefined();

    redis.eval.mockResolvedValueOnce('{bad-json');
    await expect(service.consume('bad-json')).resolves.toBeUndefined();
  });

  it('resolves callback and post-login redirect URIs', () => {
    expect(service.getAuthorizationRedirectUri({ redirectUri: 'https://api.example/api/auth/callback' })).toBe(
      'https://api.example/api/auth/callback',
    );
    expect(service.getAuthorizationRedirectUri()).toBeUndefined();
    expect(service.getPostLoginRedirectUri({ returnTo: '/polls' })).toBe('/polls');
    expect(service.getPostLoginRedirectUri({ returnTo: 'https://other.example/dashboard' })).toBe(
      'https://other.example/dashboard',
    );
    expect(service.getPostLoginRedirectUri({ returnTo: 'https://evil.example' })).toBe('https://app.example/home');
    expect(service.getPostLoginRedirectUri()).toBe('https://app.example/home');
  });

  it('uses fallback TTL and ignores relative or invalid default origins', () => {
    delete process.env.KEYCLOAK_AUTH_STATE_REDIS_PREFIX;
    process.env.KEYCLOAK_AUTH_STATE_TTL_SECONDS = '0';
    process.env.KEYCLOAK_POST_LOGIN_REDIRECT_URI = '/';
    delete process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS;
    service = new AuthorizationStateService(redis as never);

    expect(service.getPostLoginRedirectUri({ returnTo: 'https://app.example/home' })).toBe('/');
  });

  it('uses default config and empty parsed state fallbacks', async () => {
    delete process.env.KEYCLOAK_AUTH_STATE_REDIS_PREFIX;
    delete process.env.KEYCLOAK_AUTH_STATE_TTL_SECONDS;
    delete process.env.KEYCLOAK_POST_LOGIN_REDIRECT_URI;
    delete process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS;
    service = new AuthorizationStateService(redis as never);

    redis.eval.mockResolvedValueOnce(JSON.stringify({ redirectUri: 1, returnTo: 2, state: 3, prompt: 4 }));

    await expect(service.consume('state-1')).resolves.toEqual({
      redirectUri: '',
      returnTo: undefined,
      state: undefined,
      prompt: undefined,
    });
    expect(redis.eval.mock.calls[0][2]).toMatch(/^cacic-voto:auth:oauth-state:/);
    expect(service.getPostLoginRedirectUri()).toBe('/');
  });
});
