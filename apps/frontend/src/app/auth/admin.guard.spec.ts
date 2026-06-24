import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsService } from './permissions.service';
import { adminGuard } from './admin.guard';

describe('adminGuard', () => {
  let isAdmin: ReturnType<typeof signal<boolean>>;
  let permissions: Pick<PermissionsService, 'evaluateAdminPermissions' | 'isAdmin'>;
  let router: Router;

  beforeEach(() => {
    isAdmin = signal(false);
    permissions = {
      evaluateAdminPermissions: vi.fn().mockResolvedValue(undefined),
      isAdmin,
    };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PermissionsService, useValue: permissions }],
    });

    router = TestBed.inject(Router);
  });

  it('evaluates permissions before allowing admin users', async () => {
    isAdmin.set(true);

    const result = await TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(permissions.evaluateAdminPermissions).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('redirects non-admin users to the public area', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(permissions.evaluateAdminPermissions).toHaveBeenCalled();
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });
});
