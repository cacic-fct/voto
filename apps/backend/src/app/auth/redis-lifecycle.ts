import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

const DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS = 2_000;

@Injectable()
export class RedisConnectionLifecycle implements OnApplicationShutdown {
  constructor(@Inject(Redis) private readonly redis: Redis) {}

  onApplicationShutdown(): Promise<void> {
    return closeRedisConnection(this.redis);
  }
}

export async function closeRedisConnection(
  redis: Pick<Redis, 'quit' | 'disconnect' | 'status'>,
  timeoutMs = DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  if (redis.status === 'end') {
    return;
  }

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([redis.quit(), timeout]);
  } catch {
    timedOut = true;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (timedOut) {
    redis.disconnect();
  }
}
