import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthRefreshResult } from '@org/voting-contracts';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let auth: Pick<AuthService, 'refreshTokenSilently' | 'clearSession'>;

  function configure(platformId: 'browser' | 'server' = 'browser'): void {
    auth = {
      refreshTokenSilently: vi.fn().mockReturnValue(of({} as AuthRefreshResult)),
      clearSession: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: PLATFORM_ID, useValue: platformId },
      ],
    });
  }

  beforeEach(() => configure());

  it('passes server-side requests through without refreshing', async () => {
    TestBed.resetTestingModule();
    configure('server');
    const response = new HttpResponse({ status: 200 });
    const next = vi.fn().mockReturnValue(of(response));

    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/polls'), next)),
    );

    expect(result).toBe(response);
    expect(auth.refreshTokenSilently).not.toHaveBeenCalled();
  });

  it('does not refresh auth endpoint failures', async () => {
    const error = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
    const next = vi.fn().mockReturnValue(throwError(() => error));

    await expect(
      firstValueFrom(
        TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/auth/me'), next)),
      ),
    ).rejects.toBe(error);
    expect(auth.refreshTokenSilently).not.toHaveBeenCalled();
  });

  it('refreshes once and retries browser requests after 401 responses', async () => {
    const error = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
    const response = new HttpResponse({ status: 200, body: { ok: true } });
    const next = vi.fn().mockReturnValueOnce(throwError(() => error)).mockReturnValueOnce(of(response));

    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/polls'), next)),
    );

    expect(result).toBe(response);
    expect(auth.refreshTokenSilently).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('clears the session when refresh fails', async () => {
    const error = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
    const refreshError = new HttpErrorResponse({ status: 403, statusText: 'Forbidden' });
    vi.mocked(auth.refreshTokenSilently).mockReturnValue(throwError(() => refreshError));
    const next = vi.fn().mockReturnValue(throwError(() => error));

    await expect(
      firstValueFrom(
        TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/polls'), next)),
      ),
    ).rejects.toBe(refreshError);

    expect(auth.clearSession).toHaveBeenCalled();
  });

  it('passes non-auth errors through without refreshing', async () => {
    const error = new HttpErrorResponse({ status: 500, statusText: 'Server Error' });
    const next = vi.fn().mockReturnValue(throwError(() => error));

    await expect(
      firstValueFrom(
        TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/polls'), next)),
      ),
    ).rejects.toBe(error);

    expect(auth.refreshTokenSilently).not.toHaveBeenCalled();
  });
});
