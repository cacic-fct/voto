import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { AuthorizationState } from './auth.types';

@Injectable()
export class AuthorizationStateService {
  private readonly logger = new Logger(AuthorizationStateService.name);
  private readonly keyPrefix = process.env.KEYCLOAK_AUTH_STATE_REDIS_PREFIX ?? 'cacic-voto:auth:oauth-state:';
  private readonly stateTtlSeconds = this.parseDurationSeconds(process.env.KEYCLOAK_AUTH_STATE_TTL_SECONDS, 10 * 60);
  private readonly defaultPostLoginRedirectUri = process.env.KEYCLOAK_POST_LOGIN_REDIRECT_URI ?? '/';
  private readonly allowedPostLoginRedirectOrigins = this.readAllowedPostLoginRedirectOrigins();

  constructor(private readonly redis: Redis) {}

  async create(options: {
    redirectUri: string;
    returnTo?: string;
    state?: string;
    prompt?: string;
  }): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const returnTo = this.normalizePostLoginReturnTo(options.returnTo);

    await this.redis.set(
      this.getKey(state),
      JSON.stringify({
        redirectUri: options.redirectUri,
        ...(returnTo ? { returnTo } : {}),
        ...(options.state ? { state: options.state } : {}),
        ...(options.prompt ? { prompt: options.prompt } : {}),
      }),
      'EX',
      this.stateTtlSeconds,
      'NX',
    );

    return state;
  }

  async consume(state?: string): Promise<AuthorizationState | undefined> {
    if (!state) {
      return undefined;
    }

    const rawState = await this.redis.eval(
      `
local value = redis.call("get", KEYS[1])
if value then
  redis.call("del", KEYS[1])
end
return value
`,
      1,
      this.getKey(state),
    );

    if (typeof rawState !== 'string') {
      return undefined;
    }

    return this.parseStoredState(rawState);
  }

  getAuthorizationRedirectUri(state?: AuthorizationState): string | undefined {
    return state?.redirectUri;
  }

  getPostLoginRedirectUri(state?: AuthorizationState): string {
    return this.normalizePostLoginReturnTo(state?.returnTo) ?? this.defaultPostLoginRedirectUri;
  }

  private parseStoredState(rawState: string): AuthorizationState | undefined {
    try {
      const decodedState = JSON.parse(rawState);

      if (!this.isRecord(decodedState)) {
        return undefined;
      }

      return {
        redirectUri: this.readStringClaim(decodedState, 'redirectUri') ?? '',
        returnTo: this.readStringClaim(decodedState, 'returnTo'),
        state: this.readStringClaim(decodedState, 'state'),
        prompt: this.readStringClaim(decodedState, 'prompt'),
      };
    } catch {
      return undefined;
    }
  }

  private normalizePostLoginReturnTo(returnTo?: string): string | undefined {
    const normalizedReturnTo = returnTo?.trim();
    if (!normalizedReturnTo || normalizedReturnTo.startsWith('//')) {
      return undefined;
    }

    if (normalizedReturnTo.startsWith('/')) {
      return this.isAllowedAppPath(normalizedReturnTo) ? normalizedReturnTo : undefined;
    }

    try {
      const returnToUrl = new URL(normalizedReturnTo);
      return this.allowedPostLoginRedirectOrigins.has(returnToUrl.origin) && this.isAllowedAppPath(returnToUrl.pathname)
        ? returnToUrl.toString()
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isAllowedAppPath(pathname: string): boolean {
    return pathname !== '/api/auth' && !pathname.startsWith('/api/auth/');
  }

  private readAllowedPostLoginRedirectOrigins(): Set<string> {
    const origins = new Set<string>();
    this.addUrlOrigin(origins, this.defaultPostLoginRedirectUri);

    for (const origin of (process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS ?? '').split(',')) {
      this.addUrlOrigin(origins, origin.trim());
    }

    return origins;
  }

  private addUrlOrigin(origins: Set<string>, rawUrl?: string): void {
    if (!rawUrl || rawUrl.startsWith('/')) {
      return;
    }

    try {
      origins.add(new URL(rawUrl).origin);
    } catch {
      this.logger.warn(`Ignoring invalid Keycloak post-login redirect origin: ${rawUrl}`);
    }
  }

  private readStringClaim(claims: Record<string, unknown>, key: string): string | undefined {
    const value = claims[key];
    return typeof value === 'string' ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private getKey(state: string): string {
    return `${this.keyPrefix}${state}`;
  }

  private parseDurationSeconds(rawValue: string | undefined, fallback: number): number {
    const value = Number.parseInt(rawValue ?? '', 10);
    return Number.isNaN(value) || value <= 0 ? fallback : value;
  }
}
