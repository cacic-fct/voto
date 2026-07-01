import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { hasVotingAdminRole, normalizePermissions } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import { createPublicKey, type JsonWebKey, type KeyObject, randomBytes, verify as verifySignature } from 'node:crypto';
import {
  DEFAULT_KEYCLOAK_CLIENT_ID,
  DEFAULT_KEYCLOAK_REALM_URL,
} from './auth.constants';
import { AuthSessionStoreService } from './auth-session-store.service';
import { AuthorizationStateService } from './authorization-state.service';
import { AuthSession, AuthenticatedPrincipal, AuthorizationState, TokenClaims, TokenResponse } from './auth.types';
import { summarizeKeycloakFailure } from './keycloak-error-logging';
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
import { PrismaService } from '../prisma/prisma.service';

type CachedUser = {
  expiresAt: number;
  user: AuthenticatedPrincipal;
};

@Injectable()
export class KeycloakAuthService {
  private readonly logger = new Logger(KeycloakAuthService.name);
  private readonly userCache = new Map<string, CachedUser>();
  private jwksCache?: { keys: Map<string, KeyObject>; expiresAt: number };
  private readonly keycloakFailureLogs = new Map<string, { loggedAt: number; suppressed: number }>();
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
  private readonly jwksCacheTtlMs = this.parsePositiveIntegerEnv(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS, 600_000);
  private readonly jwtClockSkewSeconds = this.parsePositiveIntegerEnv(
    process.env.KEYCLOAK_JWT_CLOCK_SKEW_SECONDS,
    30,
  );

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

    const state = await this.authorizationState.create({
      redirectUri,
      returnTo: options?.returnTo,
      state: options?.state,
      prompt: options?.prompt,
    });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: options?.scope ?? 'openid profile email',
      state,
      ...(options?.prompt ? { prompt: options.prompt } : {}),
      ...(process.env.KEYCLOAK_IDP_HINT ? { kc_idp_hint: process.env.KEYCLOAK_IDP_HINT } : {}),
    });

    return {
      authorizationUrl: `${this.realmUrl}/protocol/openid-connect/auth?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForTokens(code: string, state?: AuthorizationState, redirectUri?: string): Promise<TokenResponse> {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'authorization_code');
    payload.set('code', code);
    payload.set('redirect_uri', this.authorizationState.getAuthorizationRedirectUri(state) ?? redirectUri ?? '');
    const headers = this.createFormHeaders();
    this.addClientAuthentication(payload, headers);

    try {
      const { data } = await axios.post<TokenResponse>(
        `${this.realmUrl}/protocol/openid-connect/token`,
        payload.toString(),
        { headers },
      );

      return data;
    } catch (error) {
      this.logKeycloakFailure(
        'authorization code token exchange',
        error,
        this.getTokenExchangeFailureContext(this.authorizationState.getAuthorizationRedirectUri(state) ?? redirectUri ?? ''),
      );
      throw new UnauthorizedException('Could not exchange authorization code for tokens.');
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'refresh_token');
    payload.set('refresh_token', refreshToken);
    const headers = this.createFormHeaders();
    this.addClientAuthentication(payload, headers);

    try {
      const { data } = await axios.post<TokenResponse>(
        `${this.realmUrl}/protocol/openid-connect/token`,
        payload.toString(),
        { headers },
      );

      return data;
    } catch (error) {
      this.logKeycloakFailure('refresh token exchange', error);
      throw new UnauthorizedException('Could not refresh access token.');
    }
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
    const sessionExpiresAt = this.resolveRefreshTokenExpiration(tokenResponse, accessTokenExpiresAt);
    const sessionId = randomBytes(32).toString('base64url');
    const principal = await this.getOrCreatePrincipal(tokenResponse.access_token);
    await this.syncUser(principal);

    await this.sessions.set(sessionId, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      idTokenHint: tokenResponse.id_token,
      accessTokenExpiresAt,
      sessionExpiresAt,
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
    if (stillMissing.length > 0 && !hasVotingAdminRole(principal.roles)) {
      throw new ForbiddenException(`Missing permissions: ${stillMissing.join(', ')}.`);
    }

    await this.syncUser(principal);
    return principal;
  }

  async evaluateSessionPermissions(sessionId: string, requiredPermissions: string[]): Promise<string[]> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new UnauthorizedException('Missing authenticated session.');
    }

    const principal = await this.getOrCreatePrincipal(session.accessToken);
    const normalized = normalizePermissions(requiredPermissions);
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

    return normalized.filter((permission) => principal.permissionSet.has(permission));
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
    let refreshTokenRevoked = false;

    if (input.refreshToken && this.clientSecret) {
      const payload = new URLSearchParams();
      payload.set('token', input.refreshToken);
      payload.set('token_type_hint', 'refresh_token');
      const headers = this.createFormHeaders();
      this.addClientAuthentication(payload, headers);

      try {
        await axios.post(`${this.realmUrl}/protocol/openid-connect/revoke`, payload.toString(), {
          headers,
        });
        refreshTokenRevoked = true;
      } catch (error) {
        this.logKeycloakFailure('refresh token revocation', error);
      }
    }

    const logoutUrl = new URL(`${this.realmUrl}/protocol/openid-connect/logout`);
    logoutUrl.searchParams.set('client_id', this.clientId);
    if (input.idTokenHint) {
      logoutUrl.searchParams.set('id_token_hint', input.idTokenHint);
    }

    const postLogoutRedirectUri = input.postLogoutRedirectUri ?? this.defaultPostLogoutRedirectUri;
    if (postLogoutRedirectUri) {
      logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    }

    return { refreshTokenRevoked, logoutUrl: logoutUrl.toString() };
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
      return await this.refreshStoredSessionWithLock(sessionId, refreshToken);
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

      return session;
    }

    try {
      return await this.refreshStoredSessionWithLock(sessionId, refreshToken);
    } finally {
      await this.sessions.releaseRefreshLock(sessionId, lockOwner);
    }
  }

  private async refreshStoredSessionWithLock(sessionId: string, refreshToken: string): Promise<AuthSession> {
    const tokenResponse = await this.refreshAccessToken(refreshToken);
    const currentSession = await this.sessions.get(sessionId);
    if (!currentSession || !tokenResponse.access_token) {
      throw new UnauthorizedException('Missing authenticated session.');
    }

    const accessTokenExpiresAt = this.resolveAccessTokenExpiration(tokenResponse.access_token, tokenResponse.expires_in);
    const sessionExpiresAt = this.resolveRefreshTokenExpiration(tokenResponse, currentSession.sessionExpiresAt);
    const principal = await this.getOrCreatePrincipal(tokenResponse.access_token);
    await this.syncUser(principal);

    const updatedSession = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? currentSession.refreshToken,
      idTokenHint: tokenResponse.id_token ?? currentSession.idTokenHint,
      accessTokenExpiresAt,
      sessionExpiresAt,
    };

    await this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  private async getOrCreatePrincipal(accessToken: string): Promise<AuthenticatedPrincipal> {
    const now = Date.now();
    const cachedUser = this.userCache.get(accessToken);
    if (cachedUser && cachedUser.expiresAt > now) {
      return cachedUser.user;
    }

    const mergedClaims = await this.verifyAccessTokenClaims(accessToken);

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

    return principal;
  }

  private async verifyAccessTokenClaims(accessToken: string): Promise<TokenClaims> {
    const segments = accessToken.split('.');
    if (
      segments.length !== 3 ||
      segments.some((segment) => segment.length === 0)
    ) {
      throw new UnauthorizedException('Invalid token format.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = this.decodeJwtJsonSegment(encodedHeader, 'header');
    const alg = readStringClaim(header, 'alg');
    const kid = readStringClaim(header, 'kid');

    if (alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported token signature algorithm.');
    }

    if (!kid) {
      throw new UnauthorizedException('Token signing key id is missing.');
    }

    const claims = this.decodeJwtJsonSegment(encodedPayload, 'payload');
    await this.assertJwtSignature(kid, encodedHeader, encodedPayload, encodedSignature);
    this.assertJwtIssuer(claims);
    this.assertJwtTimeClaims(claims);

    return {
      ...claims,
      active: true,
    };
  }

  private async assertJwtSignature(
    kid: string,
    encodedHeader: string,
    encodedPayload: string,
    encodedSignature: string,
  ): Promise<void> {
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = this.decodeBase64UrlSegment(encodedSignature);
    const signingKey = await this.getSigningKey(kid);

    if (verifySignature('RSA-SHA256', signingInput, signingKey, signature)) {
      return;
    }

    const refreshedSigningKey = await this.getSigningKey(kid, true);
    if (verifySignature('RSA-SHA256', signingInput, refreshedSigningKey, signature)) {
      return;
    }

    throw new UnauthorizedException('Invalid token signature.');
  }

  private async getSigningKey(kid: string, forceRefresh = false): Promise<KeyObject> {
    const keys = await this.getJwksKeys(forceRefresh);
    const key = keys.get(kid);
    if (key) {
      return key;
    }

    if (!forceRefresh) {
      const refreshedKeys = await this.getJwksKeys(true);
      const refreshedKey = refreshedKeys.get(kid);
      if (refreshedKey) {
        return refreshedKey;
      }
    }

    throw new UnauthorizedException('Unable to verify token signature.');
  }

  private async getJwksKeys(forceRefresh = false): Promise<Map<string, KeyObject>> {
    const now = Date.now();
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > now) {
      return this.jwksCache.keys;
    }

    const jwksUrl = `${this.realmUrl}/protocol/openid-connect/certs`;

    try {
      const response = await fetch(jwksUrl, {
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.warn(`Keycloak JWKS lookup failed. status=${response.status} ${response.statusText}.`);
        throw new UnauthorizedException('Unable to load Keycloak signing keys.');
      }

      const body: unknown = await response.json();
      const keys = this.parseJwks(body);
      if (keys.size === 0) {
        this.logger.warn('Keycloak JWKS response did not include usable RS256 signing keys.');
        throw new UnauthorizedException('Unable to load Keycloak signing keys.');
      }

      this.jwksCache = {
        keys,
        expiresAt: now + this.jwksCacheTtlMs,
      };

      return keys;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.warn(
        `Keycloak JWKS lookup failed. ${error instanceof Error ? `message=${error.message}.` : 'unknown error.'}`,
      );
      throw new UnauthorizedException('Unable to load Keycloak signing keys.');
    }
  }

  private parseJwks(body: unknown): Map<string, KeyObject> {
    const keys = new Map<string, KeyObject>();
    if (!isRecord(body) || !Array.isArray(body['keys'])) {
      return keys;
    }

    for (const rawKey of body['keys']) {
      if (!isRecord(rawKey)) {
        continue;
      }

      const kid = readStringClaim(rawKey, 'kid');
      const kty = readStringClaim(rawKey, 'kty');
      const use = readStringClaim(rawKey, 'use');
      const alg = readStringClaim(rawKey, 'alg');
      if (!kid || kty !== 'RSA' || (use && use !== 'sig') || (alg && alg !== 'RS256')) {
        continue;
      }

      try {
        keys.set(
          kid,
          createPublicKey({
            key: { ...rawKey } as JsonWebKey,
            format: 'jwk',
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Ignoring unusable Keycloak JWKS key. kid=${kid}; ${
            error instanceof Error ? `message=${error.message}.` : 'unknown error.'
          }`,
        );
      }
    }

    return keys;
  }

  private decodeJwtJsonSegment(segment: string, description: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.decodeBase64UrlSegment(segment).toString('utf8'));
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to a stable UnauthorizedException below.
    }

    throw new UnauthorizedException(`Invalid token ${description}.`);
  }

  private decodeBase64UrlSegment(segment: string): Buffer {
    try {
      return Buffer.from(segment, 'base64url');
    } catch {
      throw new UnauthorizedException('Invalid token encoding.');
    }
  }

  private assertJwtIssuer(claims: Record<string, unknown>): void {
    if (readStringClaim(claims, 'iss') !== this.realmUrl) {
      throw new UnauthorizedException('Invalid token issuer.');
    }
  }

  private assertJwtTimeClaims(claims: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    const exp = readNumberClaim(claims, 'exp');
    if (!exp) {
      throw new UnauthorizedException('Token missing expiration.');
    }

    if (exp < now - this.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token expired.');
    }

    const nbf = readNumberClaim(claims, 'nbf');
    if (nbf && nbf > now + this.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token is not active yet.');
    }

    const iat = readNumberClaim(claims, 'iat');
    if (iat && iat > now + this.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token issued in the future.');
    }
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
      });

      const grantedPermissions = new Set<string>();
      extractPermissionClaims(data, grantedPermissions);
      return [...grantedPermissions];
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        return [];
      }

      this.logger.warn('Keycloak authorization permission evaluation failed.');
      return [];
    }
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
        claims: principal.claims as Prisma.InputJsonValue,
        lastLoginAt: new Date(),
      },
      update: {
        preferredUsername: principal.preferredUsername,
        email: principal.email,
        name,
        roles: principal.roles,
        permissions: principal.permissions,
        claims: principal.claims as Prisma.InputJsonValue,
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
      return now + tokens.refresh_expires_in * 1000;
    }

    if (tokens.refresh_token) {
      const exp = readNumberClaim(decodeJwtPayload(tokens.refresh_token), 'exp');
      if (exp) {
        return exp * 1000;
      }
    }

    return Math.max(fallbackExpiresAt, now + 60 * 60 * 1000);
  }

  private logKeycloakFailure(operation: string, error: unknown, continuation?: string): void {
    const summary = summarizeKeycloakFailure(error);
    const logKey = `${operation}|${summary.dedupeKey}`;
    const now = Date.now();
    const previousLog = this.keycloakFailureLogs.get(logKey);

    if (previousLog && now - previousLog.loggedAt < this.keycloakFailureLogSuppressionMs) {
      previousLog.suppressed += 1;
      return;
    }

    const suppressedCount = previousLog?.suppressed ?? 0;
    this.keycloakFailureLogs.set(logKey, {
      loggedAt: now,
      suppressed: 0,
    });

    const continuationMessage = continuation ? ` ${continuation}` : '';
    const suppressionMessage =
      suppressedCount > 0
        ? ` Suppressed ${suppressedCount} similar Keycloak failure log${
            suppressedCount === 1 ? '' : 's'
          } in the last ${Math.round(this.keycloakFailureLogSuppressionMs / 1000)} seconds.`
        : '';

    this.logger.warn(`Keycloak ${operation} failed. ${summary.message}.${continuationMessage}${suppressionMessage}`);
  }

  private getTokenExchangeFailureContext(redirectUri: string): string {
    return `clientId=${this.clientId}; redirectUri=${this.formatRedirectUriForLog(
      redirectUri,
    )}; clientSecretConfigured=${this.clientSecret ? 'true' : 'false'}; tokenEndpointAuthMethod=${
      this.clientSecret ? this.tokenEndpointAuthMethod : 'none'
    }.`;
  }

  private createFormHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    return {
      'content-type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    };
  }

  private addClientAuthentication(payload: URLSearchParams, headers: Record<string, string>): void {
    if (!this.clientSecret) {
      payload.set('client_id', this.clientId);
      return;
    }

    if (this.tokenEndpointAuthMethod === 'client_secret_post') {
      payload.set('client_id', this.clientId);
      payload.set('client_secret', this.clientSecret);
      return;
    }

    headers.Authorization = `Basic ${this.getClientSecretBasicCredentials()}`;
  }

  private getClientSecretBasicCredentials(): string {
    const clientSecret = this.clientSecret;
    if (!clientSecret) {
      return '';
    }

    return Buffer.from(`${this.formEncode(this.clientId)}:${this.formEncode(clientSecret)}`, 'utf8').toString('base64');
  }

  private formEncode(value: string): string {
    const params = new URLSearchParams();
    params.set('value', value);
    return params.toString().slice('value='.length);
  }

  private formatRedirectUriForLog(redirectUri: string): string {
    try {
      const url = new URL(redirectUri);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[invalid-url]';
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
