import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  PLATFORM_ID,
  Service,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AuthRefreshResult,
  AuthenticatedUser,
  LoginOptions,
  PermissionEvaluationResponse,
} from '@org/voting-contracts';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
import { SilentSsoService } from './silent-sso.service';

export function isTransientIdentityProviderFailure(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }

  const response = error.error;
  return (
    error.status === 429 ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    (typeof response === 'object' &&
      response !== null &&
      !Array.isArray(response) &&
      (response as { code?: unknown }).code === 'KEYCLOAK_UNAVAILABLE')
  );
}

@Service()
export class AuthService {
  private readonly accountTrackingClearUrl =
    'https://account.cacic.com.br/api/tracking/clear';
  private readonly accountTrackingSessionUrl =
    'https://account.cacic.com.br/api/tracking/session';
  private readonly silentSsoAttemptStorageKey =
    'cacic-voto:silent-sso-attempted';
  private readonly postLogoutRedirectStorageKey =
    'cacic-voto:post-logout-redirect';
  private readonly logoutWarningStorageKey = 'cacic-voto:logout-warning';
  private readonly accountTrackingTimeoutMs = 3000;

  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly silentSso = inject(SilentSsoService);
  private refreshRequest$: Observable<AuthRefreshResult> | null = null;

  readonly user = signal<AuthenticatedUser | null>(null);
  readonly initialized = signal(false);
  readonly roles = computed(() => this.user()?.roles ?? []);
  readonly permissions = computed(() => this.user()?.permissions ?? []);
  readonly isAuthenticated = computed(() => Boolean(this.user()));

  async initialize(): Promise<void> {
    try {
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }

      if (await this.loadCurrentUser()) {
        return;
      }

      await this.checkExistingSsoSession();
    } finally {
      this.initialized.set(true);
    }
  }

  async login(options?: LoginOptions): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.removeSessionStorageItem(this.postLogoutRedirectStorageKey);
    this.removeSessionStorageItem(this.silentSsoAttemptStorageKey);
    window.location.assign(this.buildLoginRedirectUrl(options));
  }

  loginWithExistingSsoSession(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (
      this.hasSilentSsoFailureMarker() ||
      this.getSessionStorageItem(this.silentSsoAttemptStorageKey)
    ) {
      return;
    }

    this.setSessionStorageItem(this.silentSsoAttemptStorageKey, 'true');
    window.location.assign(
      this.buildLoginRedirectUrl({
        returnTo: this.getCurrentReturnPath(),
        prompt: 'none',
      }),
    );
  }

  private async checkExistingSsoSession(): Promise<void> {
    if (
      this.hasSilentSsoFailureMarker() ||
      this.getSessionStorageItem(this.silentSsoAttemptStorageKey)
    ) {
      return;
    }

    this.setSessionStorageItem(this.silentSsoAttemptStorageKey, 'true');

    try {
      const result = await this.silentSso.check();
      if (result === 'authenticated') {
        await this.loadCurrentUser();
      }
    } catch {
      this.removeSessionStorageItem(this.silentSsoAttemptStorageKey);
      this.loginWithExistingSsoSession();
    }
  }

  async logout(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.clearSession();
      return;
    }

    const postLogoutRedirectUri = this.getPostLogoutRedirectUri();
    let logoutResult: {
      success: boolean;
      globalLogoutComplete: boolean;
      logoutUrl?: string;
    };
    try {
      logoutResult = await firstValueFrom(
        this.http.post<{
          success: boolean;
          globalLogoutComplete: boolean;
          logoutUrl?: string;
        }>('/api/auth/logout', {
          postLogoutRedirectUri,
        }),
      );
    } catch (error) {
      const cookieExpiredFailure = this.readCookieExpiredLogoutFailure(error);
      if (!cookieExpiredFailure) {
        throw error;
      }

      this.clearSession();
      this.markPostLogoutRedirect();
      this.markLogoutWarning(false, cookieExpiredFailure.globalLogoutComplete);
      void this.clearAccountTrackingCookies();
      this.redirectTo(cookieExpiredFailure.logoutUrl ?? postLogoutRedirectUri);
      return;
    }

    this.clearSession();
    this.markPostLogoutRedirect();
    this.markLogoutWarning(true, logoutResult.globalLogoutComplete);
    void this.clearAccountTrackingCookies();

    if (logoutResult.logoutUrl) {
      this.redirectTo(logoutResult.logoutUrl);
      return;
    }

    this.redirectTo(postLogoutRedirectUri);
  }

  refreshTokenSilently(): Observable<AuthRefreshResult> {
    if (this.refreshRequest$) {
      return this.refreshRequest$;
    }

    this.refreshRequest$ = this.http
      .post<AuthRefreshResult>('/api/auth/refresh', {})
      .pipe(
        tap(() => {
          void this.loadCurrentUser();
        }),
        catchError((error) => {
          if (!isTransientIdentityProviderFailure(error)) {
            this.clearSession();
          }
          return throwError(() => error);
        }),
        finalize(() => {
          this.refreshRequest$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.refreshRequest$;
  }

  evaluatePermissions(
    permissions: readonly string[],
  ): Observable<PermissionEvaluationResponse> {
    return this.http.post<PermissionEvaluationResponse>(
      '/api/auth/permissions/evaluate',
      {
        permissions: [...new Set(permissions)],
      },
    );
  }

  clearSession(): void {
    this.user.set(null);
  }

  consumePostLogoutRedirect(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    if (!this.getSessionStorageItem(this.postLogoutRedirectStorageKey)) {
      return false;
    }

    this.removeSessionStorageItem(this.postLogoutRedirectStorageKey);
    return true;
  }

  consumeLogoutWarning(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const warning = this.getSessionStorageItem(this.logoutWarningStorageKey);
    if (!warning) {
      return null;
    }

    this.removeSessionStorageItem(this.logoutWarningStorageKey);
    if (warning === 'local-and-global') {
      return 'O cookie do navegador foi removido, mas o servidor não confirmou a remoção da sessão local. O logout global também não foi confirmado; conclua a confirmação do Keycloak, se exibida.';
    }
    if (warning === 'local') {
      return 'O cookie do navegador foi removido, mas o servidor não confirmou a remoção da sessão local. Esta sessão pode continuar válida no servidor; entre em contato com o suporte.';
    }

    return 'A sessão local foi encerrada, mas o servidor não confirmou o logout global. Se o Keycloak exibir uma confirmação, conclua-a.';
  }

  private async loadCurrentUser(): Promise<boolean> {
    try {
      const user = await firstValueFrom(
        this.http.get<AuthenticatedUser | null>('/api/auth/me'),
      );
      this.user.set(user);
      if (user) {
        this.removeSessionStorageItem(this.silentSsoAttemptStorageKey);
        this.removeSessionStorageItem(this.postLogoutRedirectStorageKey);
        void this.refreshAccountTrackingCookies();
      }
      return Boolean(user);
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 401 || error.status === 403)
      ) {
        this.user.set(null);
        return false;
      }

      if (isTransientIdentityProviderFailure(error)) {
        throw error;
      }

      this.user.set(null);

      throw error;
    }
  }

  private buildLoginRedirectUrl(options?: LoginOptions): string {
    const params = new URLSearchParams();
    params.set('returnTo', this.resolveReturnTo(options?.returnTo));

    if (options?.prompt) {
      params.set('prompt', options.prompt);
    }

    return `/api/auth/login/redirect?${params.toString()}`;
  }

  private getCurrentReturnPath(): string {
    const { pathname, search, hash } = window.location;
    return `${pathname}${search}${hash}`;
  }

  private getPostLogoutRedirectUri(): string {
    return this.getApplicationRootUrl();
  }

  private redirectTo(url: string): void {
    window.location.assign(url);
  }

  private async refreshAccountTrackingCookies(): Promise<void> {
    await this.callAccountTrackingEndpoint(
      this.accountTrackingSessionUrl,
      'GET',
    );
  }

  private async clearAccountTrackingCookies(): Promise<void> {
    await this.callAccountTrackingEndpoint(
      this.accountTrackingClearUrl,
      'POST',
    );
  }

  private async callAccountTrackingEndpoint(
    url: string,
    method: 'GET' | 'POST',
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), this.accountTrackingTimeoutMs);
    try {
      await fetch(url, {
        credentials: 'include',
        method,
        signal: controller.signal,
      });
    } catch {
      return;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private hasSilentSsoFailureMarker(): boolean {
    try {
      return new URL(window.location.href).searchParams.get('sso') === 'none';
    } catch {
      return false;
    }
  }

  private getSessionStorageItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private setSessionStorageItem(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      return;
    }
  }

  private removeSessionStorageItem(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      return;
    }
  }

  private resolveReturnTo(returnTo?: string): string {
    if (!isPlatformBrowser(this.platformId)) {
      return '/';
    }

    const target = returnTo?.trim() || '/';
    try {
      return new URL(target, this.document.location.origin).toString();
    } catch {
      return this.document.location.origin;
    }
  }

  private getApplicationRootUrl(): string {
    const baseHref =
      this.document.querySelector('base')?.getAttribute('href') ?? '/';
    const basePath = new URL(baseHref, window.location.origin).pathname;
    const normalizedBasePath = basePath.endsWith('/')
      ? basePath
      : `${basePath}/`;

    return new URL(normalizedBasePath, window.location.origin).toString();
  }

  private markPostLogoutRedirect(): void {
    this.setSessionStorageItem(this.postLogoutRedirectStorageKey, 'true');
    this.setSessionStorageItem(this.silentSsoAttemptStorageKey, 'true');
  }

  private markLogoutWarning(
    localSessionCleared: boolean,
    globalLogoutComplete: boolean,
  ): void {
    if (localSessionCleared && globalLogoutComplete) {
      this.removeSessionStorageItem(this.logoutWarningStorageKey);
      return;
    }

    this.setSessionStorageItem(
      this.logoutWarningStorageKey,
      localSessionCleared ? 'global' : globalLogoutComplete ? 'local' : 'local-and-global',
    );
  }

  private readCookieExpiredLogoutFailure(
    error: unknown,
  ): { globalLogoutComplete: boolean; logoutUrl?: string } | null {
    if (!(error instanceof HttpErrorResponse)) {
      return null;
    }

    const body = error.error;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      (body as Record<string, unknown>)['cookieExpired'] !== true
    ) {
      return null;
    }

    const response = body as Record<string, unknown>;
    return {
      globalLogoutComplete: response['globalLogoutComplete'] === true,
      logoutUrl: typeof response['logoutUrl'] === 'string' ? response['logoutUrl'] : undefined,
    };
  }
}
