import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

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
          switchMap(() => next(request)),
          catchError((refreshError) => {
            auth.clearSession();
            return throwError(() => refreshError);
          }),
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
    request.url.includes('/api/auth/logout')
  );
}
