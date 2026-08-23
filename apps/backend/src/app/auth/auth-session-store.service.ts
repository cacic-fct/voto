import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthSession } from './auth.types';

@Injectable()
export class AuthSessionStoreService {
  private readonly logger = new Logger(AuthSessionStoreService.name);
  private readonly keyPrefix = process.env.KEYCLOAK_AUTH_SESSION_REDIS_PREFIX ?? 'cacic-voto:auth:session:';
  private readonly refreshLockTtlMs = this.parseDurationMs(process.env.KEYCLOAK_AUTH_REFRESH_LOCK_TTL_MS, 5_000);
  private readonly refreshLockWaitMs = this.parseDurationMs(process.env.KEYCLOAK_AUTH_REFRESH_LOCK_WAIT_MS, 15_000);
  private readonly refreshLockPollMs = this.parseDurationMs(process.env.KEYCLOAK_AUTH_REFRESH_LOCK_POLL_MS, 50);

  constructor(private readonly redis: Redis) {}

  async get(sessionId: string): Promise<AuthSession | undefined> {
    const rawSession = await this.redis.get(this.getKey(sessionId));
    if (!rawSession) {
      return undefined;
    }

    try {
      const session = JSON.parse(rawSession) as AuthSession;
      const absoluteDeadline = session.sessionAbsoluteDeadline ?? session.sessionExpiresAt;
      if (
        !this.isValidSession(session) ||
        session.sessionExpiresAt <= Date.now() ||
        absoluteDeadline <= Date.now()
      ) {
        await this.delete(sessionId);
        return undefined;
      }

      return session.sessionAbsoluteDeadline !== undefined && session.sessionExpiresAt > absoluteDeadline
        ? { ...session, sessionExpiresAt: absoluteDeadline }
        : session;
    } catch {
      this.logger.warn(`Ignoring unreadable auth session ${sessionId}.`);
      await this.delete(sessionId);
      return undefined;
    }
  }

  async set(sessionId: string, session: AuthSession): Promise<void> {
    const boundedSession =
      session.sessionAbsoluteDeadline !== undefined && session.sessionExpiresAt > session.sessionAbsoluteDeadline
        ? { ...session, sessionExpiresAt: session.sessionAbsoluteDeadline }
        : session;
    const ttlSeconds = this.resolveTtlSeconds(boundedSession.sessionExpiresAt);
    if (ttlSeconds <= 0) {
      await this.delete(sessionId);
      return;
    }

    await this.redis.set(this.getKey(sessionId), JSON.stringify(boundedSession), 'EX', ttlSeconds);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.getKey(sessionId));
  }

  async acquireRefreshLock(sessionId: string, owner: string): Promise<boolean> {
    const result = await this.redis.set(this.getRefreshLockKey(sessionId), owner, 'PX', this.refreshLockTtlMs, 'NX');
    return result === 'OK';
  }

  async releaseRefreshLock(sessionId: string, owner: string): Promise<void> {
    await this.redis.eval(
      `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`,
      1,
      this.getRefreshLockKey(sessionId),
      owner,
    );
  }

  async renewRefreshLock(sessionId: string, owner: string): Promise<boolean> {
    const result = await this.redis.eval(
      `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`,
      1,
      this.getRefreshLockKey(sessionId),
      owner,
      String(this.refreshLockTtlMs),
    );
    return result === 1;
  }

  async waitForRefreshLockRelease(sessionId: string): Promise<void> {
    const lockKey = this.getRefreshLockKey(sessionId);
    const expiresAt = Date.now() + this.refreshLockWaitMs;

    while (Date.now() < expiresAt) {
      if (!(await this.redis.exists(lockKey))) {
        return;
      }

      await this.sleep(this.refreshLockPollMs);
    }
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private getRefreshLockKey(sessionId: string): string {
    return `${this.getKey(sessionId)}:refresh-lock`;
  }

  private resolveTtlSeconds(expiresAt: number): number {
    return Math.ceil((expiresAt - Date.now()) / 1000);
  }

  private isValidSession(session: AuthSession): boolean {
    return (
      typeof session.accessToken === 'string' &&
      Number.isFinite(session.accessTokenExpiresAt) &&
      Number.isFinite(session.sessionExpiresAt) &&
      (session.sessionAbsoluteDeadline === undefined || Number.isFinite(session.sessionAbsoluteDeadline)) &&
      (session.refreshToken === undefined || typeof session.refreshToken === 'string') &&
      (session.idTokenHint === undefined || typeof session.idTokenHint === 'string')
    );
  }

  private parseDurationMs(rawValue: string | undefined, fallback: number): number {
    const value = Number.parseInt(rawValue ?? '', 10);
    return Number.isNaN(value) || value <= 0 ? fallback : value;
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
