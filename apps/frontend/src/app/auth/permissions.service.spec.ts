import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VOTING_ADMIN_PERMISSIONS } from '@org/voting-contracts';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let permissions: PermissionsService;
  let authPermissions: ReturnType<typeof signal<string[]>>;
  let roles: ReturnType<typeof signal<string[]>>;
  let isAuthenticated: ReturnType<typeof signal<boolean>>;
  let auth: Pick<AuthService, 'permissions' | 'roles' | 'isAuthenticated' | 'evaluatePermissions'>;

  beforeEach(() => {
    authPermissions = signal([]);
    roles = signal([]);
    isAuthenticated = signal(false);
    auth = {
      permissions: authPermissions,
      roles,
      isAuthenticated,
      evaluatePermissions: vi.fn().mockReturnValue(of({ permissions: [] })),
    };

    TestBed.configureTestingModule({
      providers: [PermissionsService, { provide: AuthService, useValue: auth }],
    });

    permissions = TestBed.inject(PermissionsService);
  });

  it('combines direct and evaluated permissions in sorted order', async () => {
    authPermissions.set(['polls:write', 'polls:read']);
    isAuthenticated.set(true);
    vi.mocked(auth.evaluatePermissions).mockReturnValue(of({ permissions: ['admin:polls', 'polls:read'] }));

    await permissions.evaluateAdminPermissions();

    expect(permissions.rawPermissions()).toEqual(['admin:polls', 'polls:read', 'polls:write']);
  });

  it('does not evaluate permissions for guests', async () => {
    await permissions.evaluateAdminPermissions();

    expect(auth.evaluatePermissions).not.toHaveBeenCalled();
    expect(permissions.rawPermissions()).toEqual([]);
  });

  it('reuses the in-flight admin permission evaluation', async () => {
    const evaluation = new Subject<{ permissions: string[] }>();
    isAuthenticated.set(true);
    vi.mocked(auth.evaluatePermissions).mockReturnValue(evaluation);

    const first = permissions.evaluateAdminPermissions();
    const second = permissions.evaluateAdminPermissions();
    evaluation.next({ permissions: ['admin:polls'] });
    evaluation.complete();

    await Promise.all([first, second]);

    expect(auth.evaluatePermissions).toHaveBeenCalledTimes(1);
    expect(auth.evaluatePermissions).toHaveBeenCalledWith(VOTING_ADMIN_PERMISSIONS);
    expect(permissions.rawPermissions()).toEqual(['admin:polls']);
  });

  it('clears evaluated permissions when remote evaluation fails', async () => {
    authPermissions.set(['polls:read']);
    isAuthenticated.set(true);
    vi.mocked(auth.evaluatePermissions)
      .mockReturnValueOnce(of({ permissions: ['admin:polls'] }))
      .mockReturnValueOnce(throwError(() => new Error('offline')));

    await permissions.evaluateAdminPermissions();
    expect(permissions.rawPermissions()).toEqual(['admin:polls', 'polls:read']);

    await permissions.evaluateAdminPermissions();
    expect(permissions.rawPermissions()).toEqual(['polls:read']);
  });

  it('recognizes admin users through roles or permissions', async () => {
    roles.set(['voting-admin']);
    expect(permissions.isAdmin()).toBe(true);

    roles.set([]);
    authPermissions.set([...VOTING_ADMIN_PERMISSIONS]);
    expect(permissions.isAdmin()).toBe(true);
  });
});
