import { getRedisConnectionOptions } from './redis-connection';

describe('getRedisConnectionOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_DB;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses localhost defaults without REDIS_URL', () => {
    const options = getRedisConnectionOptions();

    expect(options).toMatchObject({
      host: 'localhost',
      port: 6379,
      db: 0,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    expect(options.password).toBeUndefined();
    expect(options.retryStrategy?.(1)).toBe(100);
    expect(options.retryStrategy?.(30)).toBe(2000);
  });

  it('uses explicit host, port, password, and db environment variables', () => {
    process.env.REDIS_HOST = 'redis.local';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';
    process.env.REDIS_DB = '2';

    expect(getRedisConnectionOptions()).toMatchObject({
      host: 'redis.local',
      port: 6380,
      password: 'secret',
      db: 2,
    });
  });

  it('parses redis URLs', () => {
    process.env.REDIS_URL = 'redis://user%201:pass%202@redis.example:6381/4';

    expect(getRedisConnectionOptions()).toMatchObject({
      host: 'redis.example',
      port: 6381,
      username: 'user 1',
      password: 'pass 2',
      db: 4,
      tls: undefined,
    });
    expect(getRedisConnectionOptions().retryStrategy?.(30)).toBe(2000);
  });

  it('defaults URL port and enables TLS for rediss URLs', () => {
    process.env.REDIS_URL = 'rediss://secure.example';

    expect(getRedisConnectionOptions()).toMatchObject({
      host: 'secure.example',
      port: 6379,
      tls: {},
    });
    expect(getRedisConnectionOptions().db).toBeUndefined();
  });
});
