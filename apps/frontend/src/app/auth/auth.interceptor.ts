import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthService, isTransientIdentityProviderFailure } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const auth = inject(AuthService);
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId) || shouldSkipRefresh(request)) {
    return next(request);
  }

  return next(request).pipe(
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        return auth.refreshTokenSilently().pipe(
          catchError((refreshError) => {
            if (!isTransientIdentityProviderFailure(refreshError)) {
              auth.clearSession();
            }
            return throwError(() => refreshError);
          }),
          switchMap(() => next(request)),
        );
      }

      return throwError(() => error);
    }),
  );
};

function shouldSkipRefresh(request: HttpRequest<unknown>): boolean {
  return (
    request.url.includes('/api/auth/refresh') ||
    request.url.includes('/api/auth/me') ||
    request.url.includes('/api/auth/logout') ||
    // Kiosk authorization uses 401 for an invalid voter's TOTP. It is a
    // business validation failure and must not refresh the administrator's
    // session or replay the one-time authorization attempt.
    request.url.includes('/api/admin/polls/') && request.url.includes('/kiosk/authorization')
  );
}
