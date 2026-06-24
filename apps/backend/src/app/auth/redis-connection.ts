import { RedisOptions } from 'ioredis';

export function getRedisConnectionOptions(): RedisOptions {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    return {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
      ...parseRedisUrl(redisUrl),
    };
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number.parseInt(process.env.REDIS_DB ?? '0', 10),
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
  };
}

function parseRedisUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}
