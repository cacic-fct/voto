import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthenticatedUser, AuthRefreshResult, LoginOptions } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  const user: AuthenticatedUser = {
    sub: 'user-1',
    preferredUsername: 'maria',
    email: 'maria@cacic.test',
    roles: ['authenticated-user'],
    permissions: ['polls:read'],
    scopes: ['openid'],
    oidcScopes: ['openid'],
  };

  function configure(platformId: 'browser' | 'server' = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platformId },
      ],
    });

    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    window.location.hash = '';
  });

  it('loads the current user during browser initialization', async () => {
    const initialize = service.initialize();

    http.expectOne('/api/auth/me').flush(user);
    await initialize;

    expect(service.initialized()).toBe(true);
    expect(service.user()).toEqual(user);
    expect(service.roles()).toEqual(['authenticated-user']);
    expect(service.permissions()).toEqual(['polls:read']);
    expect(service.isAuthenticated()).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://account.cacic.dev.br/api/tracking/session', {
      credentials: 'include',
      method: 'GET',
    });
  });

  it('marks initialization complete without loading a user on the server', async () => {
    TestBed.resetTestingModule();
    configure('server');
    const internals = service as unknown as { resolveReturnTo(returnTo?: string): string };

    await service.initialize();

    expect(service.initialized()).toBe(true);
    expect(internals.resolveReturnTo('/admin')).toBe('/');
    http.expectNone('/api/auth/me');
  });

  it('attempts silent SSO and keeps initialization successful for auth failures', async () => {
    const internals = service as unknown as { buildLoginRedirectUrl(options?: LoginOptions): string };
    const redirectSpy = vi.spyOn(internals, 'buildLoginRedirectUrl').mockReturnValue('#silent-login');
    service.user.set(user);

    const initialize = service.initialize();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await initialize;

    expect(service.initialized()).toBe(true);
    expect(service.user()).toBeNull();
    expect(redirectSpy).toHaveBeenCalledWith({
      returnTo: expect.any(String),
      prompt: 'none',
    });
    expect(window.location.hash).toBe('#silent-login');
    redirectSpy.mockRestore();
  });

  it('rethrows unexpected initialization failures after marking initialization complete', async () => {
    const initialize = service.initialize();

    http.expectOne('/api/auth/me').flush({}, { status: 500, statusText: 'Server Error' });

    await expect(initialize).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(service.initialized()).toBe(true);
  });

  it('clears the current session on server-side logout', async () => {
    TestBed.resetTestingModule();
    configure('server');
    service.user.set(user);

    await service.logout();

    expect(service.user()).toBeNull();
    http.expectNone('/api/auth/logout');
  });

  it('ignores login requests during server rendering', async () => {
    TestBed.resetTestingModule();
    configure('server');

    await service.login({ returnTo: '/admin' });

    http.expectNone('/api/auth/login/redirect');
  });

  it('attempts browser login redirects with the resolved backend URL', async () => {
    const internals = service as unknown as { buildLoginRedirectUrl(options?: LoginOptions): string };
    const redirectSpy = vi.spyOn(internals, 'buildLoginRedirectUrl').mockReturnValue('#auth-login');
    window.location.hash = '';

    await service.login({ returnTo: '/admin', prompt: 'login' });

    expect(redirectSpy).toHaveBeenCalledWith({ returnTo: '/admin', prompt: 'login' });
    expect(window.location.hash).toBe('#auth-login');
    redirectSpy.mockRestore();
  });

  it('posts the logout redirect and clears the session', async () => {
    const internals = service as unknown as { redirectTo(url: string): void };
    const redirectSpy = vi.spyOn(internals, 'redirectTo').mockImplementation(() => undefined);
    const rootUrl = new URL('/', window.location.origin).toString();
    service.user.set(user);

    const logout = service.logout();
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      postLogoutRedirectUri: rootUrl,
    });
    request.flush({});
    await logout;

    expect(service.user()).toBeNull();
    expect(service.consumePostLogoutRedirect()).toBe(true);
    expect(service.consumePostLogoutRedirect()).toBe(false);
    expect(fetch).toHaveBeenCalledWith('https://account.cacic.dev.br/api/tracking/clear', {
      credentials: 'include',
      method: 'POST',
    });
    expect(redirectSpy).toHaveBeenCalledWith(rootUrl);

    redirectSpy.mockRestore();
  });

  it('redirects to returned logout URLs and clears the session after logout failures', async () => {
    const internals = service as unknown as { redirectTo(url: string): void };
    const redirectSpy = vi.spyOn(internals, 'redirectTo').mockImplementation(() => undefined);
    const rootUrl = new URL('/', window.location.origin).toString();
    service.user.set(user);

    const redirectedLogout = service.logout();
    http.expectOne('/api/auth/logout').flush({ logoutUrl: '#logged-out' });
    await redirectedLogout;
    expect(service.user()).toBeNull();
    expect(fetch).toHaveBeenCalledWith('https://account.cacic.dev.br/api/tracking/clear', {
      credentials: 'include',
      method: 'POST',
    });
    expect(redirectSpy).toHaveBeenCalledWith('#logged-out');

    service.user.set(user);
    const failedLogout = service.logout();
    http.expectOne('/api/auth/logout').flush({}, { status: 500, statusText: 'Server Error' });
    await failedLogout;
    expect(service.user()).toBeNull();
    expect(redirectSpy).toHaveBeenLastCalledWith(rootUrl);

    redirectSpy.mockRestore();
  });

  it('shares an in-flight refresh request and reloads the user after success', async () => {
    const refreshResult = { refreshed: true } as unknown as AuthRefreshResult;
    const firstRefresh = firstValueFrom(service.refreshTokenSilently());
    const secondRefresh = firstValueFrom(service.refreshTokenSilently());

    http.expectOne('/api/auth/refresh').flush(refreshResult);
    http.expectOne('/api/auth/me').flush(user);

    await expect(firstRefresh).resolves.toEqual(refreshResult);
    await expect(secondRefresh).resolves.toEqual(refreshResult);
    expect(service.user()).toEqual(user);
  });

  it('clears the session and allows a new refresh request after refresh failure', async () => {
    service.user.set(user);

    const refresh = firstValueFrom(service.refreshTokenSilently());
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(refresh).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(service.user()).toBeNull();

    const nextRefresh = firstValueFrom(service.refreshTokenSilently());
    http.expectOne('/api/auth/refresh').flush({} as AuthRefreshResult);
    http.expectOne('/api/auth/me').flush(null);
    await nextRefresh;
  });

  it('deduplicates permission evaluation requests', async () => {
    const response = firstValueFrom(service.evaluatePermissions(['polls:read', 'polls:read', 'polls:write']));
    const request = http.expectOne('/api/auth/permissions/evaluate');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ permissions: ['polls:read', 'polls:write'] });
    request.flush({ permissions: ['polls:read'] });

    await expect(response).resolves.toEqual({ permissions: ['polls:read'] });
  });

  it('builds login redirects with resolved return URLs and optional prompts', () => {
    const internals = service as unknown as {
      buildLoginRedirectUrl(options?: LoginOptions): string;
      resolveReturnTo(returnTo?: string): string;
    };

    const redirect = internals.buildLoginRedirectUrl({ returnTo: '/admin', prompt: 'login' });
    const params = new URLSearchParams(redirect.split('?')[1]);

    expect(redirect.startsWith('/api/auth/login/redirect?')).toBe(true);
    expect(params.get('returnTo')).toBe(new URL('/admin', TestBed.inject(DOCUMENT).location.origin).toString());
    expect(params.get('prompt')).toBe('login');
    expect(internals.resolveReturnTo('http://[')).toBe(TestBed.inject(DOCUMENT).location.origin);
  });

  it('does not attempt silent SSO twice or after SSO failure markers', () => {
    const internals = service as unknown as {
      buildLoginRedirectUrl(options?: LoginOptions): string;
      loginWithExistingSsoSession(): void;
    };
    const redirectSpy = vi.spyOn(internals, 'buildLoginRedirectUrl').mockReturnValue('#silent-login');

    window.history.replaceState({}, '', '/polls?sso=none');
    internals.loginWithExistingSsoSession();
    expect(redirectSpy).not.toHaveBeenCalled();

    window.history.replaceState({}, '', '/polls');
    internals.loginWithExistingSsoSession();
    expect(redirectSpy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#silent-login');

    window.history.replaceState({}, '', '/polls');
    internals.loginWithExistingSsoSession();
    expect(redirectSpy).toHaveBeenCalledTimes(1);
    redirectSpy.mockRestore();
  });
});
