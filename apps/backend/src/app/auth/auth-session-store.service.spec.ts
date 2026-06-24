import { AuthSessionStoreService } from './auth-session-store.service';
import { AuthSession } from './auth.types';

type RedisMock = {
  get: jest.Mock<Promise<string | null>, [string]>;
  set: jest.Mock<Promise<string | null>, [string, ...unknown[]]>;
  del: jest.Mock<Promise<number>, [string]>;
  eval: jest.Mock<Promise<number>, [string, number, ...unknown[]]>;
  exists: jest.Mock<Promise<number>, [string]>;
};

function createRedisMock(): RedisMock {
  return {
    get: jest.fn<Promise<string | null>, [string]>(),
    set: jest.fn<Promise<string | null>, [string, ...unknown[]]>(),
    del: jest.fn<Promise<number>, [string]>(),
    eval: jest.fn<Promise<number>, [string, number, ...unknown[]]>(),
    exists: jest.fn<Promise<number>, [string]>(),
  };
}

describe('AuthSessionStoreService', () => {
  const originalEnv = process.env;
  let redis: RedisMock;
  let service: AuthSessionStoreService;

  beforeEach(() => {
    jest.useRealTimers();
    process.env = {
      ...originalEnv,
      KEYCLOAK_AUTH_SESSION_REDIS_PREFIX: 'test:session:',
      KEYCLOAK_AUTH_REFRESH_LOCK_WAIT_MS: '2',
      KEYCLOAK_AUTH_REFRESH_LOCK_POLL_MS: '1',
      KEYCLOAK_AUTH_REFRESH_LOCK_TTL_MS: '5',
    };
    redis = createRedisMock();
    service = new AuthSessionStoreService(redis as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns undefined when a session is missing', async () => {
    redis.get.mockResolvedValue(null);

    await expect(service.get('missing')).resolves.toBeUndefined();
    expect(redis.get).toHaveBeenCalledWith('test:session:missing');
  });

  it('returns valid sessions', async () => {
    const session: AuthSession = {
      accessToken: 'access',
      refreshToken: 'refresh',
      idTokenHint: 'id-token',
      accessTokenExpiresAt: Date.now() + 1000,
      sessionExpiresAt: Date.now() + 2000,
    };
    redis.get.mockResolvedValue(JSON.stringify(session));

    await expect(service.get('session-1')).resolves.toEqual(session);
  });

  it('deletes unreadable, invalid, and expired sessions', async () => {
    redis.get.mockResolvedValueOnce('{bad-json');
    await expect(service.get('bad-json')).resolves.toBeUndefined();

    redis.get.mockResolvedValueOnce(JSON.stringify({ accessToken: 'token' }));
    await expect(service.get('invalid')).resolves.toBeUndefined();

    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        accessToken: 'token',
        accessTokenExpiresAt: Date.now() + 1000,
        sessionExpiresAt: Date.now() - 1,
      }),
    );
    await expect(service.get('expired')).resolves.toBeUndefined();

    expect(redis.del).toHaveBeenCalledTimes(3);
  });

  it('stores sessions with a positive TTL and deletes expired sessions on set', async () => {
    const session: AuthSession = {
      accessToken: 'access',
      accessTokenExpiresAt: Date.now() + 1000,
      sessionExpiresAt: Date.now() + 1500,
    };

    await service.set('session-1', session);
    expect(redis.set).toHaveBeenCalledWith('test:session:session-1', JSON.stringify(session), 'EX', 2);

    await service.set('expired', { ...session, sessionExpiresAt: Date.now() - 100 });
    expect(redis.del).toHaveBeenCalledWith('test:session:expired');
  });

  it('deletes sessions', async () => {
    await service.delete('session-1');

    expect(redis.del).toHaveBeenCalledWith('test:session:session-1');
  });

  it('acquires and releases refresh locks', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(service.acquireRefreshLock('session-1', 'owner')).resolves.toBe(true);
    await expect(service.acquireRefreshLock('session-1', 'owner')).resolves.toBe(false);

    await service.releaseRefreshLock('session-1', 'owner');
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("get"'), 1, 'test:session:session-1:refresh-lock', 'owner');
  });

  it('waits until the refresh lock is released or times out', async () => {
    redis.exists.mockResolvedValueOnce(0);
    await service.waitForRefreshLockRelease('session-1');
    expect(redis.exists).toHaveBeenCalledTimes(1);

    redis.exists.mockClear();
    redis.exists.mockResolvedValue(1);
    await service.waitForRefreshLockRelease('session-2');
    expect(redis.exists).toHaveBeenCalled();
  });

  it('falls back to default lock durations when env values are invalid', async () => {
    process.env.KEYCLOAK_AUTH_REFRESH_LOCK_TTL_MS = '-1';
    process.env.KEYCLOAK_AUTH_REFRESH_LOCK_WAIT_MS = 'bad';
    process.env.KEYCLOAK_AUTH_REFRESH_LOCK_POLL_MS = '0';
    service = new AuthSessionStoreService(redis as never);
    redis.set.mockResolvedValue('OK');

    await service.acquireRefreshLock('session-1', 'owner');

    expect(redis.set).toHaveBeenCalledWith('test:session:session-1:refresh-lock', 'owner', 'PX', 5000, 'NX');
  });

  it('falls back to the default session key prefix', async () => {
    delete process.env.KEYCLOAK_AUTH_SESSION_REDIS_PREFIX;
    delete process.env.KEYCLOAK_AUTH_REFRESH_LOCK_TTL_MS;
    service = new AuthSessionStoreService(redis as never);

    redis.set.mockResolvedValue('OK');
    await service.acquireRefreshLock('session-1', 'owner');
    await service.delete('session-1');

    expect(redis.set).toHaveBeenCalledWith(
      'cacic-voto:auth:session:session-1:refresh-lock',
      'owner',
      'PX',
      5000,
      'NX',
    );
    expect(redis.del).toHaveBeenCalledWith('cacic-voto:auth:session:session-1');
  });
});
