import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionsService } from './permissions.service';

export const adminGuard: CanActivateFn = async () => {
  const permissions = inject(PermissionsService);
  const router = inject(Router);

  await permissions.evaluateAdminPermissions();
  return permissions.isAdmin() ? true : router.parseUrl('/');
};
