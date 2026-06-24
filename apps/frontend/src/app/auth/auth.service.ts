import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import {
  AuthRefreshResult,
  AuthenticatedUser,
  LoginOptions,
  PermissionEvaluationResponse,
} from '@org/voting-contracts';
import { Observable, catchError, finalize, firstValueFrom, shareReplay, tap, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accountTrackingClearUrl = 'https://account.cacic.dev.br/api/tracking/clear';
  private readonly accountTrackingSessionUrl = 'https://account.cacic.dev.br/api/tracking/session';
  private readonly silentSsoAttemptStorageKey = 'cacic-voto:silent-sso-attempted';
  private readonly postLogoutRedirectStorageKey = 'cacic-voto:post-logout-redirect';

  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
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

      this.loginWithExistingSsoSession();
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

  async logout(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.clearSession();
      return;
    }

    const postLogoutRedirectUri = this.getPostLogoutRedirectUri();

    try {
      const { logoutUrl } = await firstValueFrom(
        this.http.post<{ logoutUrl?: string }>('/api/auth/logout', {
          postLogoutRedirectUri,
        }),
      );
      await this.clearAccountTrackingCookies();
      this.clearSession();
      this.markPostLogoutRedirect();

      if (logoutUrl) {
        this.redirectTo(logoutUrl);
        return;
      }
    } catch {
      await this.clearAccountTrackingCookies();
      this.clearSession();
      this.markPostLogoutRedirect();
    }

    this.redirectTo(postLogoutRedirectUri);
  }

  refreshTokenSilently(): Observable<AuthRefreshResult> {
    if (this.refreshRequest$) {
      return this.refreshRequest$;
    }

    this.refreshRequest$ = this.http.post<AuthRefreshResult>('/api/auth/refresh', {}).pipe(
      tap(() => {
        void this.loadCurrentUser();
      }),
      catchError((error) => {
        this.clearSession();
        return throwError(() => error);
      }),
      finalize(() => {
        this.refreshRequest$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.refreshRequest$;
  }

  evaluatePermissions(permissions: readonly string[]): Observable<PermissionEvaluationResponse> {
    return this.http.post<PermissionEvaluationResponse>('/api/auth/permissions/evaluate', {
      permissions: [...new Set(permissions)],
    });
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

  private async loadCurrentUser(): Promise<boolean> {
    try {
      const user = await firstValueFrom(this.http.get<AuthenticatedUser | null>('/api/auth/me'));
      this.user.set(user);
      if (user) {
        this.removeSessionStorageItem(this.silentSsoAttemptStorageKey);
        this.removeSessionStorageItem(this.postLogoutRedirectStorageKey);
        void this.refreshAccountTrackingCookies();
      }
      return Boolean(user);
    } catch (error) {
      this.user.set(null);

      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
        return false;
      }

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
    await this.callAccountTrackingEndpoint(this.accountTrackingSessionUrl, 'GET');
  }

  private async clearAccountTrackingCookies(): Promise<void> {
    await this.callAccountTrackingEndpoint(this.accountTrackingClearUrl, 'POST');
  }

  private async callAccountTrackingEndpoint(
    url: string,
    method: 'GET' | 'POST',
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await fetch(url, {
        credentials: 'include',
        method,
      });
    } catch {
      return;
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
    const baseHref = this.document.querySelector('base')?.getAttribute('href') ?? '/';
    const basePath = new URL(baseHref, window.location.origin).pathname;
    const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;

    return new URL(normalizedBasePath, window.location.origin).toString();
  }

  private markPostLogoutRedirect(): void {
    this.setSessionStorageItem(this.postLogoutRedirectStorageKey, 'true');
    this.setSessionStorageItem(this.silentSsoAttemptStorageKey, 'true');
  }
}
