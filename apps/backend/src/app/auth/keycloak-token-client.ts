import { Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import { TokenResponse } from './auth.types';
import { summarizeKeycloakFailure } from './keycloak-error-logging';

export type KeycloakTokenEndpointAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post';

export type KeycloakTokenClientOptions = {
  realmUrl: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: KeycloakTokenEndpointAuthMethod;
  defaultPostLogoutRedirectUri?: string;
  failureLogSuppressionMs: number;
  requestTimeoutMs?: number;
  logger: Logger;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_FAILURE_LOG_ENTRIES = 1_024;

export class KeycloakTokenClient {
  private readonly failureLogs = new Map<
    string,
    { loggedAt: number; suppressed: number }
  >();

  constructor(private readonly options: KeycloakTokenClientOptions) {}

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<TokenResponse> {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'authorization_code');
    payload.set('code', code);
    payload.set('redirect_uri', redirectUri);
    const headers = this.createFormHeaders();
    this.addClientAuthentication(payload, headers);

    try {
      const { data } = await axios.post<TokenResponse>(
        `${this.options.realmUrl}/protocol/openid-connect/token`,
        payload.toString(),
        { headers, timeout: this.requestTimeoutMs },
      );

      return data;
    } catch (error) {
      this.logKeycloakFailure(
        'authorization code token exchange',
        error,
        this.getTokenExchangeFailureContext(redirectUri),
      );
      throw new UnauthorizedException(
        'Could not exchange authorization code for tokens.',
      );
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
        `${this.options.realmUrl}/protocol/openid-connect/token`,
        payload.toString(),
        { headers, timeout: this.requestTimeoutMs },
      );

      return data;
    } catch (error) {
      this.logKeycloakFailure('refresh token exchange', error);
      throw new UnauthorizedException('Could not refresh access token.');
    }
  }

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    if (!this.options.clientSecret) {
      return false;
    }

    const payload = new URLSearchParams();
    payload.set('token', refreshToken);
    payload.set('token_type_hint', 'refresh_token');
    const headers = this.createFormHeaders();
    this.addClientAuthentication(payload, headers);

    try {
      await axios.post(
        `${this.options.realmUrl}/protocol/openid-connect/revoke`,
        payload.toString(),
        { headers, timeout: this.requestTimeoutMs },
      );
      return true;
    } catch (error) {
      this.logKeycloakFailure('refresh token revocation', error);
      return false;
    }
  }

  createLogoutUrl(input: {
    idTokenHint?: string;
    postLogoutRedirectUri?: string;
  }): string {
    const logoutUrl = new URL(
      `${this.options.realmUrl}/protocol/openid-connect/logout`,
    );
    logoutUrl.searchParams.set('client_id', this.options.clientId);
    if (input.idTokenHint) {
      logoutUrl.searchParams.set('id_token_hint', input.idTokenHint);
    }

    const postLogoutRedirectUri =
      input.postLogoutRedirectUri ?? this.options.defaultPostLogoutRedirectUri;
    if (postLogoutRedirectUri) {
      logoutUrl.searchParams.set(
        'post_logout_redirect_uri',
        postLogoutRedirectUri,
      );
    }

    return logoutUrl.toString();
  }

  private createFormHeaders(
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    return {
      'content-type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    };
  }

  private addClientAuthentication(
    payload: URLSearchParams,
    headers: Record<string, string>,
  ): void {
    if (!this.options.clientSecret) {
      payload.set('client_id', this.options.clientId);
      return;
    }

    if (this.options.tokenEndpointAuthMethod === 'client_secret_post') {
      payload.set('client_id', this.options.clientId);
      payload.set('client_secret', this.options.clientSecret);
      return;
    }

    headers.Authorization = `Basic ${this.getClientSecretBasicCredentials()}`;
  }

  private getClientSecretBasicCredentials(): string {
    const clientSecret = this.options.clientSecret;
    if (!clientSecret) {
      return '';
    }

    return Buffer.from(
      `${this.formEncode(this.options.clientId)}:${this.formEncode(clientSecret)}`,
      'utf8',
    ).toString('base64');
  }

  private formEncode(value: string): string {
    const params = new URLSearchParams();
    params.set('value', value);
    return params.toString().slice('value='.length);
  }

  private getTokenExchangeFailureContext(redirectUri: string): string {
    return `clientId=${this.options.clientId}; redirectUri=${this.formatRedirectUriForLog(
      redirectUri,
    )}; clientSecretConfigured=${
      this.options.clientSecret ? 'true' : 'false'
    }; tokenEndpointAuthMethod=${
      this.options.clientSecret
        ? this.options.tokenEndpointAuthMethod
        : 'none'
    }.`;
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

  private logKeycloakFailure(
    operation: string,
    error: unknown,
    continuation?: string,
  ): void {
    const summary = summarizeKeycloakFailure(error);
    const logKey = `${operation}|${summary.dedupeKey}`;
    const now = Date.now();
    this.pruneFailureLogs(now);
    const previousLog = this.failureLogs.get(logKey);

    if (
      previousLog &&
      now - previousLog.loggedAt < this.options.failureLogSuppressionMs
    ) {
      previousLog.suppressed += 1;
      return;
    }

    const suppressedCount = previousLog?.suppressed ?? 0;
    this.failureLogs.set(logKey, {
      loggedAt: now,
      suppressed: 0,
    });
    while (this.failureLogs.size > MAX_FAILURE_LOG_ENTRIES) {
      const oldest = this.failureLogs.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.failureLogs.delete(oldest);
    }

    const continuationMessage = continuation ? ` ${continuation}` : '';
    const suppressionMessage =
      suppressedCount > 0
        ? ` Suppressed ${suppressedCount} similar Keycloak failure log${
            suppressedCount === 1 ? '' : 's'
          } in the last ${Math.round(this.options.failureLogSuppressionMs / 1000)} seconds.`
        : '';

    this.options.logger.warn(
      `Keycloak ${operation} failed. ${summary.message}.${continuationMessage}${suppressionMessage}`,
    );
  }

  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs && this.options.requestTimeoutMs > 0
      ? this.options.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private pruneFailureLogs(now: number): void {
    for (const [key, entry] of this.failureLogs) {
      if (now - entry.loggedAt >= this.options.failureLogSuppressionMs * 2) {
        this.failureLogs.delete(key);
      }
    }
  }
}
