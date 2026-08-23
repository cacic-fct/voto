import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { hasElectionsObserverRole, hasVotingAdminRole, normalizePermissions } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_KEYCLOAK_CLIENT_ID,
  DEFAULT_KEYCLOAK_REALM_URL,
} from './auth.constants';
import { AuthSessionStoreService } from './auth-session-store.service';
import { AuthorizationStateService } from './authorization-state.service';
import { AuthSession, AuthenticatedPrincipal, AuthorizationState, TokenResponse } from './auth.types';
import {
  decodeJwtPayload,
  extractOidcScopes,
  extractPermissionClaims,
  extractPermissions,
  extractRoles,
  isRecord,
  readNumberClaim,
  readStringClaim,
} from './keycloak-claims.utils';
import { KeycloakTokenClient } from './keycloak-token-client';
import { KeycloakTokenVerifier } from './keycloak-token-verifier';
import { PrismaService } from '../prisma/prisma.service';

type CachedUser = {
  expiresAt: number;
  user: AuthenticatedPrincipal;
};

const MAX_PERMISSION_REQUESTS = 50;
const MAX_PERMISSION_LENGTH = 128;
const MAX_AUTHORIZATION_SCOPE_LENGTH = 128;
const MAX_AUTHORIZATION_SCOPE_COUNT = 8;
const ALLOWED_OIDC_SCOPES = new Set(['openid', 'profile', 'email']);
const ALLOWED_OIDC_PROMPTS = new Set(['none', 'login', 'consent', 'select_account']);
const DEFAULT_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_USER_CACHE_ENTRIES = 1_000;
const MAX_REFRESH_LOCK_RENEWAL_MS = 5_000;
const PERSISTED_CLAIM_KEYS = new Set([
  'sub',
  'preferred_username',
  'email',
  'name',
  'given_name',
  'family_name',
  'enrollmentNumber',
  'enrollment_number',
  'academicId',
  'academic_id',
  'secondary_emails',
  'secondaryEmails',
  'unesp_role',
  'unespRole',
  'unesp_role_verified',
  'is_unesp_role_verified',
  'unespRoleVerified',
  'isUnespRoleVerified',
]);

@Injectable()
export class KeycloakAuthService {
  private readonly logger = new Logger(KeycloakAuthService.name);
  private readonly userCache = new Map<string, CachedUser>();
  private readonly accessTokenRefreshSkewMs = 30_000;
  private readonly keycloakFailureLogSuppressionMs = 60_000;

  private readonly realmUrl = (process.env.KEYCLOAK_REALM_URL ?? DEFAULT_KEYCLOAK_REALM_URL).replace(/\/+$/, '');
  private readonly clientId = process.env.KEYCLOAK_CLIENT_ID ?? DEFAULT_KEYCLOAK_CLIENT_ID;
  private readonly clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  private readonly tokenEndpointAuthMethod = this.readTokenEndpointAuthMethod();
  private readonly allowedAccessTokenClients = this.readAllowedAccessTokenClients();
  private readonly defaultRedirectUri = process.env.KEYCLOAK_REDIRECT_URI;
  private readonly defaultPostLogoutRedirectUri = process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI;
  private readonly cacheTtlMs = this.parsePositiveIntegerEnv(
    process.env.KEYCLOAK_PRINCIPAL_CACHE_TTL_MS ?? process.env.KEYCLOAK_INTROSPECTION_CACHE_TTL_MS,
    10_000,
  );
  private readonly maxUserCacheEntries = this.parsePositiveIntegerEnv(
    process.env.KEYCLOAK_PRINCIPAL_CACHE_MAX_ENTRIES,
    MAX_USER_CACHE_ENTRIES,
  );
  private readonly keycloakRequestTimeoutMs = this.parsePositiveIntegerEnv(
    process.env.KEYCLOAK_REQUEST_TIMEOUT_MS,
    10_000,
  );
  private readonly refreshLockRenewalMs = Math.min(
    this.parsePositiveIntegerEnv(process.env.KEYCLOAK_AUTH_REFRESH_LOCK_RENEWAL_MS, MAX_REFRESH_LOCK_RENEWAL_MS),
    Math.max(1, Math.floor(this.parsePositiveIntegerEnv(process.env.KEYCLOAK_AUTH_REFRESH_LOCK_TTL_MS, 5_000) / 3)),
  );
  private readonly jwksCacheTtlMs = this.parsePositiveIntegerEnv(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS, 600_000);
  private readonly jwtClockSkewSeconds = this.parsePositiveIntegerEnv(
    process.env.KEYCLOAK_JWT_CLOCK_SKEW_SECONDS,
    30,
  );
  private readonly tokenVerifier = new KeycloakTokenVerifier({
    realmUrl: this.realmUrl,
    jwksCacheTtlMs: this.jwksCacheTtlMs,
    jwtClockSkewSeconds: this.jwtClockSkewSeconds,
    requestTimeoutMs: this.keycloakRequestTimeoutMs,
    logger: this.logger,
  });
  private readonly tokenClient = new KeycloakTokenClient({
    realmUrl: this.realmUrl,
    clientId: this.clientId,
    clientSecret: this.clientSecret,
    tokenEndpointAuthMethod: this.tokenEndpointAuthMethod,
    defaultPostLogoutRedirectUri: this.defaultPostLogoutRedirectUri,
    failureLogSuppressionMs: this.keycloakFailureLogSuppressionMs,
    requestTimeoutMs: this.keycloakRequestTimeoutMs,
    logger: this.logger,
  });

  constructor(
    private readonly sessions: AuthSessionStoreService,
    private readonly authorizationState: AuthorizationStateService,
    private readonly prisma: PrismaService,
  ) {}

  async buildAuthorizationUrl(options?: {
    redirectUri?: string;
    returnTo?: string;
    state?: string;
    scope?: string;
    prompt?: string;
  }): Promise<{ authorizationUrl: string; state: string }> {
    const redirectUri = options?.redirectUri ?? this.defaultRedirectUri;
    if (!redirectUri) {
      throw new UnauthorizedException('Missing Keycloak redirect URI.');
    }

    const scope = this.normalizeAuthorizationScope(options?.scope);
    const prompt = this.normalizeAuthorizationPrompt(options?.prompt);

    const state = await this.authorizationState.create({
      redirectUri,
      returnTo: options?.returnTo,
      state: options?.state,
      prompt,
    });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
      ...(prompt ? { prompt } : {}),
      ...(process.env.KEYCLOAK_IDP_HINT ? { kc_idp_hint: process.env.KEYCLOAK_IDP_HINT } : {}),
    });

    return {
      authorizationUrl: `${this.realmUrl}/protocol/openid-connect/auth?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForTokens(code: string, state?: AuthorizationState, redirectUri?: string): Promise<TokenResponse> {
    return this.tokenClient.exchangeCodeForTokens(
      code,
      this.authorizationState.getAuthorizationRedirectUri(state) ?? redirectUri ?? '',
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    return this.tokenClient.refreshAccessToken(refreshToken);
  }

  async createSession(tokenResponse: TokenResponse): Promise<{
    sessionId: string;
    expiresAt: number;
    sessionExpiresAt: number;
  }> {
    if (!tokenResponse.access_token) {
      throw new UnauthorizedException('Missing access token in auth response.');
    }

    const accessTokenExpiresAt = this.resolveAccessTokenExpiration(tokenResponse.access_token, tokenResponse.expires_in);
    const sessionAbsoluteDeadline = this.resolveInitialSessionDeadline(tokenResponse, accessTokenExpiresAt);
    const sessionExpiresAt = sessionAbsoluteDeadline;
    const sessionId = randomBytes(32).toString('base64url');
    const principal = await this.getOrCreatePrincipal(tokenResponse.access_token);
    await this.syncUser(principal);

    await this.sessions.set(sessionId, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      idTokenHint: tokenResponse.id_token,
      accessTokenExpiresAt,
      sessionExpiresAt,
      sessionAbsoluteDeadline,
    });

    return { sessionId, expiresAt: accessTokenExpiresAt, sessionExpiresAt };
  }

  async refreshSession(sessionId: string): Promise<{ expiresAt: number; sessionExpiresAt: number }> {
    const session = await this.sessions.get(sessionId);
    if (!session?.refreshToken) {
      throw new UnauthorizedException('Missing refresh token in session.');
    }

    const refreshedSession = await this.refreshStoredSession(sessionId, session.refreshToken);

    return {
      expiresAt: refreshedSession.accessTokenExpiresAt,
      sessionExpiresAt: refreshedSession.sessionExpiresAt,
    };
  }

  async authenticateSession(sessionId: string, requiredPermissions: readonly string[] = []): Promise<AuthenticatedPrincipal> {
    let session = await this.sessions.get(sessionId);
    if (!session) {
      throw new UnauthorizedException('Missing authenticated session.');
    }

    if (this.shouldRefreshSessionAccessToken(session.accessTokenExpiresAt) && session.refreshToken) {
      session = await this.refreshStoredSession(sessionId, session.refreshToken);
    }

    let principal: AuthenticatedPrincipal;
    try {
      principal = await this.getOrCreatePrincipal(session.accessToken);
    } catch (error) {
      if (!session.refreshToken || !(error instanceof UnauthorizedException)) {
        throw error;
      }

      session = await this.refreshStoredSession(sessionId, session.refreshToken);
      principal = await this.getOrCreatePrincipal(session.accessToken);
    }
    const missingPermissions = requiredPermissions.filter((permission) => !principal.permissionSet.has(permission));

    if (missingPermissions.length > 0 && !hasVotingAdminRole(principal.roles)) {
      const granted = await this.evaluatePermissions(session.accessToken, missingPermissions);

      for (const permission of granted) {
        principal.permissionSet.add(permission);
      }

      principal.permissions = [...principal.permissionSet];
    }

    const stillMissing = requiredPermissions.filter((permission) => !principal.permissionSet.has(permission));
    if (
      stillMissing.length > 0 &&
      !hasVotingAdminRole(principal.roles) &&
      !this.isObserverReadOnlyGrant(principal, stillMissing)
    ) {
      throw new ForbiddenException(`Missing permissions: ${stillMissing.join(', ')}.`);
    }

    await this.syncUser(principal);
    return principal;
  }

  async authenticateMachineToMachineToken(
    accessToken: string,
    requiredRoles: readonly string[],
    allowedClientIds: readonly string[],
  ): Promise<AuthenticatedPrincipal> {
    const principal = await this.getOrCreatePrincipal(accessToken);

    if (!this.isServiceAccountPrincipal(principal)) {
      throw new ForbiddenException('Access token is not a service account token.');
    }

    const clientId = this.readClientId(principal);
    if (!clientId || !allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Service account client is not allowed.');
    }

    const missingRoles = requiredRoles.filter(
      (role) =>
        !principal.roleSet.has(role) &&
        !allowedClientIds.some((clientId) => principal.roleSet.has(`${clientId}:${role}`)),
    );
    if (missingRoles.length > 0) {
      throw new ForbiddenException(`Missing required role(s): ${missingRoles.join(', ')}.`);
    }

    return principal;
  }

  async evaluateSessionPermissions(sessionId: string, requiredPermissions: string[]): Promise<string[]> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new UnauthorizedException('Missing authenticated session.');
    }

    this.assertPermissionRequest(requiredPermissions);
    const normalized = normalizePermissions(requiredPermissions);
    this.assertPermissionRequest(normalized);
    const principal = await this.getOrCreatePrincipal(session.accessToken);
    if (hasVotingAdminRole(principal.roles)) {
      return normalized;
    }

    const missingPermissions = normalized.filter((permission) => !principal.permissionSet.has(permission));
    if (missingPermissions.length > 0) {
      const grantedPermissions = await this.evaluatePermissions(session.accessToken, missingPermissions);
      for (const permission of grantedPermissions) {
        principal.permissionSet.add(permission);
      }
      principal.permissions = [...principal.permissionSet];
      await this.syncUser(principal);
    }

    return normalized.filter(
      (permission) =>
        principal.permissionSet.has(permission) ||
        (permission === 'poll#read' && hasElectionsObserverRole(principal.roles)),
    );
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }

  async getSessionLogoutInput(sessionId: string): Promise<{ refreshToken?: string; idTokenHint?: string } | null> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      refreshToken: session.refreshToken,
      idTokenHint: session.idTokenHint,
    };
  }

  async logout(input: {
    refreshToken?: string;
    idTokenHint?: string;
    postLogoutRedirectUri?: string;
  }): Promise<{ refreshTokenRevoked: boolean; logoutUrl: string }> {
    const refreshTokenRevoked = input.refreshToken
      ? await this.tokenClient.revokeRefreshToken(input.refreshToken)
      : false;

    return {
      refreshTokenRevoked,
      logoutUrl: this.tokenClient.createLogoutUrl({
        idTokenHint: input.idTokenHint,
        postLogoutRedirectUri: input.postLogoutRedirectUri,
      }),
    };
  }

  getPostLoginRedirectUri(state?: AuthorizationState): string {
    return this.authorizationState.getPostLoginRedirectUri(state);
  }

  consumeAuthorizationState(state?: string): Promise<AuthorizationState | undefined> {
    return this.authorizationState.consume(state);
  }

  private async refreshStoredSession(sessionId: string, refreshToken: string): Promise<AuthSession> {
    const lockOwner = randomBytes(16).toString('base64url');
    const hasLock = await this.sessions.acquireRefreshLock(sessionId, lockOwner);

    if (!hasLock) {
      await this.sessions.waitForRefreshLockRelease(sessionId);
      const session = await this.sessions.get(sessionId);
      if (!session) {
        throw new UnauthorizedException('Missing authenticated session.');
      }

      if (!this.shouldRefreshSessionAccessToken(session.accessTokenExpiresAt)) {
        return session;
      }

      return this.refreshStoredSessionAfterLockTimeout(sessionId, session.refreshToken ?? refreshToken);
    }

    try {
      return await this.refreshStoredSessionWithLock(sessionId, refreshToken, lockOwner);
    } finally {
      await this.sessions.releaseRefreshLock(sessionId, lockOwner);
    }
  }

  private async refreshStoredSessionAfterLockTimeout(sessionId: string, refreshToken: string): Promise<AuthSession> {
    const lockOwner = randomBytes(16).toString('base64url');
    const hasLock = await this.sessions.acquireRefreshLock(sessionId, lockOwner);

    if (!hasLock) {
      await this.sessions.waitForRefreshLockRelease(sessionId);
      const session = await this.sessions.get(sessionId);
      if (!session) {
        throw new UnauthorizedException('Missing authenticated session.');
      }

      if (!this.shouldRefreshSessionAccessToken(session.accessTokenExpiresAt)) {
        return session;
      }

      throw new ServiceUnavailableException('Authentication refresh is still in progress.');
    }

    try {
      return await this.refreshStoredSessionWithLock(sessionId, refreshToken, lockOwner);
    } finally {
      await this.sessions.releaseRefreshLock(sessionId, lockOwner);
    }
  }

  private async refreshStoredSessionWithLock(sessionId: string, refreshToken: string, lockOwner: string): Promise<AuthSession> {
    let lockLost = false;
    let renewalInFlight: Promise<void> | undefined;
    const renewLock = async (): Promise<void> => {
      try {
        const renewed = await this.sessions.renewRefreshLock(sessionId, lockOwner);
        if (!renewed) {
          lockLost = true;
          this.logger.warn('Authentication refresh lock ownership was lost.');
        }
      } catch {
        lockLost = true;
        this.logger.warn('Could not renew the authentication refresh lock.');
      }
    };

    await renewLock();
    if (lockLost) {
      throw new ServiceUnavailableException('Authentication refresh lock was lost.');
    }

    // The caller already holds the lock. Keep the lease alive for a slow
    // Keycloak response so a second request cannot reuse a rotating token.
    const lockRenewal: ReturnType<typeof setInterval> = setInterval(() => {
      renewalInFlight = renewLock();
    }, this.refreshLockRenewalMs);
    const tokenResponse = await this.refreshAccessToken(refreshToken).finally(() => {
      clearInterval(lockRenewal);
    });
    if (renewalInFlight) {
      await renewalInFlight;
    }
    if (lockLost) {
      throw new ServiceUnavailableException('Authentication refresh lock was lost.');
    }
    const currentSession = await this.sessions.get(sessionId);
    if (!currentSession || !tokenResponse.access_token) {
      throw new UnauthorizedException('Missing authenticated session.');
    }

    const accessTokenExpiresAt = this.resolveAccessTokenExpiration(tokenResponse.access_token, tokenResponse.expires_in);
    const sessionAbsoluteDeadline = currentSession.sessionAbsoluteDeadline ?? currentSession.sessionExpiresAt;
    const sessionExpiresAt = this.resolveRefreshTokenExpiration(tokenResponse, sessionAbsoluteDeadline);
    const principal = await this.getOrCreatePrincipal(tokenResponse.access_token);
    await this.syncUser(principal);

    const updatedSession = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? currentSession.refreshToken,
      idTokenHint: tokenResponse.id_token ?? currentSession.idTokenHint,
      accessTokenExpiresAt,
      sessionExpiresAt,
      sessionAbsoluteDeadline,
    };

    await this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  private async getOrCreatePrincipal(accessToken: string): Promise<AuthenticatedPrincipal> {
    const now = Date.now();
    const cachedUser = this.userCache.get(accessToken);
    if (cachedUser && cachedUser.expiresAt > now) {
      this.userCache.delete(accessToken);
      this.userCache.set(accessToken, cachedUser);
      return cachedUser.user;
    }
    this.pruneUserCache(now);

    const mergedClaims = await this.tokenVerifier.verifyAccessTokenClaims(accessToken);

    const roles = extractRoles(mergedClaims);
    const permissions = extractPermissions(mergedClaims);
    const scopes = extractOidcScopes(mergedClaims);

    const principal: AuthenticatedPrincipal = {
      sub: readStringClaim(mergedClaims, 'sub'),
      preferredUsername: readStringClaim(mergedClaims, 'preferred_username'),
      email: readStringClaim(mergedClaims, 'email'),
      roles,
      permissions,
      scopes,
      oidcScopes: scopes,
      claims: mergedClaims,
      token: accessToken,
      roleSet: new Set(roles),
      permissionSet: new Set(permissions),
    };
    this.assertAccessTokenClientAllowed(principal);

    const expSeconds = readNumberClaim(mergedClaims, 'exp');
    const expBasedCache = expSeconds ? expSeconds * 1000 : now + this.cacheTtlMs;

    this.userCache.set(accessToken, {
      user: principal,
      expiresAt: Math.min(expBasedCache, now + this.cacheTtlMs),
    });
    this.pruneUserCache(now);

    return principal;
  }

  private async evaluatePermissions(accessToken: string, requiredPermissions: string[]): Promise<string[]> {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'urn:ietf:params:oauth:grant-type:uma-ticket');
    payload.set('audience', this.clientId);
    payload.set('response_mode', 'permissions');
    payload.set('response_include_resource_name', 'true');
    payload.set('client_id', this.clientId);

    if (this.clientSecret) {
      payload.set('client_secret', this.clientSecret);
    }

    for (const permission of requiredPermissions) {
      payload.append('permission', permission);
    }

    try {
      const { data } = await axios.post(`${this.realmUrl}/protocol/openid-connect/token`, payload.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        timeout: this.keycloakRequestTimeoutMs,
      });

      const grantedPermissions = new Set<string>();
      extractPermissionClaims(data, grantedPermissions);
      return [...grantedPermissions];
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        return [];
      }

      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Keycloak authorization permission evaluation failed. status=${status ?? 'none'}.`);
      if (status === 401) {
        return [];
      }

      throw new ServiceUnavailableException('Keycloak authorization service is unavailable.');
    }
  }

  private isObserverReadOnlyGrant(principal: AuthenticatedPrincipal, missingPermissions: readonly string[]): boolean {
    return hasElectionsObserverRole(principal.roles) && missingPermissions.every((permission) => permission === 'poll#read');
  }

  private async syncUser(principal: AuthenticatedPrincipal): Promise<void> {
    if (!principal.sub) {
      return;
    }

    const name = this.readName(principal.claims);

    await this.prisma.user.upsert({
      where: { id: principal.sub },
      create: {
        id: principal.sub,
        preferredUsername: principal.preferredUsername,
        email: principal.email,
        name,
        roles: principal.roles,
        permissions: principal.permissions,
        claims: this.minimizePersistedClaims(principal.claims) as Prisma.InputJsonValue,
        lastLoginAt: new Date(),
      },
      update: {
        preferredUsername: principal.preferredUsername,
        email: principal.email,
        name,
        roles: principal.roles,
        permissions: principal.permissions,
        claims: this.minimizePersistedClaims(principal.claims) as Prisma.InputJsonValue,
        lastLoginAt: new Date(),
      },
    });
  }

  private readName(claims: Record<string, unknown>): string | undefined {
    const name = claims['name'];
    if (typeof name === 'string' && name.trim()) {
      return name.trim();
    }

    const givenName = typeof claims['given_name'] === 'string' ? claims['given_name'] : '';
    const familyName = typeof claims['family_name'] === 'string' ? claims['family_name'] : '';
    const fullName = `${givenName} ${familyName}`.trim();
    return fullName || undefined;
  }

  private shouldRefreshSessionAccessToken(expiresAt: number): boolean {
    return expiresAt - Date.now() <= this.accessTokenRefreshSkewMs;
  }

  private resolveAccessTokenExpiration(accessToken: string, expiresInSeconds?: number): number {
    const now = Date.now();
    if (typeof expiresInSeconds === 'number' && expiresInSeconds > 0) {
      return now + expiresInSeconds * 1000;
    }

    const exp = readNumberClaim(decodeJwtPayload(accessToken), 'exp');
    return exp ? exp * 1000 : now + 60 * 60 * 1000;
  }

  private resolveRefreshTokenExpiration(tokens: TokenResponse, fallbackExpiresAt: number): number {
    const now = Date.now();
    if (typeof tokens.refresh_expires_in === 'number' && tokens.refresh_expires_in > 0) {
      return Math.min(fallbackExpiresAt, now + tokens.refresh_expires_in * 1000);
    }

    if (tokens.refresh_token) {
      const exp = readNumberClaim(decodeJwtPayload(tokens.refresh_token), 'exp');
      if (exp) {
        return Math.min(fallbackExpiresAt, exp * 1000);
      }
    }

    return fallbackExpiresAt;
  }

  private resolveInitialSessionDeadline(tokens: TokenResponse, accessTokenExpiresAt: number): number {
    const now = Date.now();
    if (typeof tokens.refresh_expires_in === 'number' && tokens.refresh_expires_in > 0) {
      return now + tokens.refresh_expires_in * 1000;
    }
    if (tokens.refresh_token) {
      const exp = readNumberClaim(decodeJwtPayload(tokens.refresh_token), 'exp');
      if (exp) {
        return exp * 1000;
      }
    }
    return Math.max(accessTokenExpiresAt, Date.now() + DEFAULT_SESSION_MAX_AGE_MS);
  }

  private assertPermissionRequest(permissions: readonly string[]): void {
    if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) {
      throw new BadRequestException('Permissions must be an array of strings.');
    }
    if (permissions.length > MAX_PERMISSION_REQUESTS || permissions.some((permission) => permission.length > MAX_PERMISSION_LENGTH)) {
      throw new BadRequestException('Too many or oversized permissions requested.');
    }
  }

  private normalizeAuthorizationScope(rawScope?: string): string {
    if (rawScope !== undefined && typeof rawScope !== 'string') {
      throw new BadRequestException('Authorization scope is invalid.');
    }
    const scope = rawScope?.trim() || 'openid profile email';
    if (scope.length > MAX_AUTHORIZATION_SCOPE_LENGTH) {
      throw new BadRequestException('Authorization scope is too long.');
    }

    const normalized = [...new Set(scope.split(/\s+/).filter(Boolean))];
    if (normalized.length > MAX_AUTHORIZATION_SCOPE_COUNT || normalized.some((item) => !ALLOWED_OIDC_SCOPES.has(item))) {
      throw new BadRequestException('Authorization scope contains an unsupported value.');
    }
    return normalized.join(' ');
  }

  private normalizeAuthorizationPrompt(rawPrompt?: string): string | undefined {
    if (rawPrompt !== undefined && typeof rawPrompt !== 'string') {
      throw new BadRequestException('Authorization prompt is invalid.');
    }
    const prompt = rawPrompt?.trim();
    if (!prompt) {
      return undefined;
    }
    if (!ALLOWED_OIDC_PROMPTS.has(prompt)) {
      throw new BadRequestException('Authorization prompt contains an unsupported value.');
    }
    return prompt;
  }

  private minimizePersistedClaims(claims: Record<string, unknown>): Record<string, unknown> {
    const persisted: Record<string, unknown> = {};
    for (const key of PERSISTED_CLAIM_KEYS) {
      if (claims[key] !== undefined) {
        persisted[key] = claims[key];
      }
    }

    if (isRecord(claims['attributes'])) {
      const attributes: Record<string, unknown> = {};
      for (const key of PERSISTED_CLAIM_KEYS) {
        if (claims['attributes'][key] !== undefined) {
          attributes[key] = claims['attributes'][key];
        }
      }
      if (Object.keys(attributes).length > 0) {
        persisted.attributes = attributes;
      }
    }

    return persisted;
  }

  private pruneUserCache(now: number): void {
    for (const [token, cached] of this.userCache) {
      if (cached.expiresAt <= now) {
        this.userCache.delete(token);
      }
    }
    while (this.userCache.size > this.maxUserCacheEntries) {
      const oldest = this.userCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.userCache.delete(oldest);
    }
  }

  private parsePositiveIntegerEnv(rawValue: string | undefined, fallback: number): number {
    const parsedTtl = Number.parseInt(rawValue ?? '', 10);
    if (Number.isNaN(parsedTtl) || parsedTtl <= 0) {
      return fallback;
    }

    return parsedTtl;
  }

  private readTokenEndpointAuthMethod(): 'client_secret_basic' | 'client_secret_post' {
    const value = process.env.KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD?.trim();

    if (value === 'client_secret_basic' || value === 'client_secret_post') {
      return value;
    }

    if (value) {
      this.logger.warn(
        `Unsupported KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD="${value}". Falling back to client_secret_basic.`,
      );
    }

    return 'client_secret_basic';
  }

  private readAllowedAccessTokenClients(): Set<string> {
    const clients = new Set<string>([this.clientId]);

    for (const client of (process.env.KEYCLOAK_ALLOWED_ACCESS_TOKEN_CLIENTS ?? '').split(',')) {
      const normalizedClient = client.trim();
      if (normalizedClient) {
        clients.add(normalizedClient);
      }
    }

    return clients;
  }

  private assertAccessTokenClientAllowed(principal: AuthenticatedPrincipal): void {
    if (this.isServiceAccountPrincipal(principal)) {
      return;
    }

    const authorizedParty = this.readClientId(principal);
    if (authorizedParty && this.allowedAccessTokenClients.has(authorizedParty)) {
      return;
    }

    for (const client of this.allowedAccessTokenClients) {
      if (this.hasAudience(principal.claims['aud'], client)) {
        return;
      }
    }

    throw new UnauthorizedException('Access token was not issued for an allowed CACiC Voto client.');
  }

  private isServiceAccountPrincipal(principal: AuthenticatedPrincipal): boolean {
    const clientId = this.readClientId(principal);
    return Boolean(clientId && principal.preferredUsername === `service-account-${clientId}`);
  }

  private readClientId(principal: AuthenticatedPrincipal): string | undefined {
    return readStringClaim(principal.claims, 'azp') ?? readStringClaim(principal.claims, 'client_id');
  }

  private hasAudience(rawAudience: unknown, expectedAudience: string): boolean {
    if (typeof rawAudience === 'string') {
      return rawAudience === expectedAudience;
    }

    if (!Array.isArray(rawAudience)) {
      return false;
    }

    return rawAudience.some((audience) => audience === expectedAudience);
  }
}
