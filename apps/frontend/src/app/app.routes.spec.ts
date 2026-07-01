import { describe, expect, it } from 'vitest';
import { adminGuard } from './auth/admin.guard';
import { authGuard, redirectAuthenticatedGuard } from './auth/auth.guard';
import { appRoutes } from './app.routes';

describe('appRoutes', () => {
  it('declares login, authenticated shell, admin, and fallback routes', () => {
    expect(appRoutes.map((route) => route.path)).toEqual(['login', '', '**']);
    expect(appRoutes[0]?.canActivate).toEqual([redirectAuthenticatedGuard]);
    expect(appRoutes[1]?.canActivate).toEqual([authGuard]);
    expect(appRoutes[2]?.redirectTo).toBe('');

    const children = appRoutes[1]?.children ?? [];
    expect(children.map((route) => route.path)).toEqual([
      '',
      'polls',
      'polls/direct/:directLinkToken/results',
      'polls/direct/:directLinkToken',
      'polls/:id/results',
      'polls/:id',
      'admin',
    ]);
    expect(children[0]).toMatchObject({ pathMatch: 'full', redirectTo: 'polls' });
    expect(children[6]?.canActivate).toEqual([adminGuard]);
  });

  it('lazy-loads route components', async () => {
    await expect(appRoutes[0]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(appRoutes[1]?.loadComponent?.()).resolves.toBeTruthy();

    const children = appRoutes[1]?.children ?? [];
    await expect(children[1]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(children[2]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(children[3]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(children[4]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(children[5]?.loadComponent?.()).resolves.toBeTruthy();
    await expect(children[6]?.loadComponent?.()).resolves.toBeTruthy();
  }, 15000);
});
