import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { authGuard, redirectAuthenticatedGuard } from './auth.guard';

describe('auth guards', () => {
  let isAuthenticated: ReturnType<typeof signal<boolean>>;
  let auth: Pick<AuthService, 'isAuthenticated' | 'login' | 'consumePostLogoutRedirect'>;
  let router: Router;

  beforeEach(() => {
    isAuthenticated = signal(false);
    auth = {
      isAuthenticated,
      login: vi.fn().mockResolvedValue(undefined),
      consumePostLogoutRedirect: vi.fn().mockReturnValue(false),
    };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });

    router = TestBed.inject(Router);
  });

  it('allows authenticated users through protected routes', () => {
    isAuthenticated.set(true);

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot),
    );

    expect(result).toBe(true);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('starts login and redirects guests to the login page', () => {
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot),
    );

    expect(auth.login).toHaveBeenCalledWith({ returnTo: '/admin' });
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects guests after logout without starting a new login', () => {
    vi.mocked(auth.consumePostLogoutRedirect).mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot),
    );

    expect(auth.login).not.toHaveBeenCalled();
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects authenticated users away from login', () => {
    isAuthenticated.set(true);

    const result = TestBed.runInInjectionContext(() =>
      redirectAuthenticatedGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('allows guests to open login', () => {
    const result = TestBed.runInInjectionContext(() =>
      redirectAuthenticatedGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(result).toBe(true);
  });
});
