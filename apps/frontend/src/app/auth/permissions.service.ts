import { Service, computed, inject, linkedSignal } from '@angular/core';
import {
  AuthenticatedUser,
  VOTING_ADMIN_PERMISSIONS,
  hasPollKioskPermission,
  hasVotingAdminPermission,
  hasVotingAdminWritePermission,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

@Service()
export class PermissionsService {
  private readonly auth = inject(AuthService);
  private readonly evaluatedPermissions = linkedSignal({
    source: this.auth.user,
    computation: (): string[] => [],
  });
  private evaluation: {
    user: AuthenticatedUser;
    promise: Promise<void>;
  } | null = null;

  readonly rawPermissions = computed(() => {
    const permissions = new Set(this.auth.permissions());
    for (const permission of this.evaluatedPermissions()) {
      permissions.add(permission);
    }

    return [...permissions].sort();
  });

  readonly isAdmin = computed(() =>
    hasVotingAdminPermission(this.rawPermissions(), this.auth.roles()),
  );
  readonly canManageAdmin = computed(() =>
    hasVotingAdminWritePermission(this.rawPermissions(), this.auth.roles()),
  );
  readonly canUseKiosk = computed(() =>
    hasPollKioskPermission(this.rawPermissions(), this.auth.roles()),
  );

  async evaluateAdminPermissions(): Promise<void> {
    const user = this.auth.user();
    if (!user) {
      return;
    }
    if (this.evaluation?.user === user) {
      return this.evaluation.promise;
    }

    const evaluation = { user, promise: this.fetchAdminPermissions(user) };
    this.evaluation = evaluation;
    try {
      await evaluation.promise;
    } finally {
      if (this.evaluation === evaluation) {
        this.evaluation = null;
      }
    }
  }

  private async fetchAdminPermissions(user: AuthenticatedUser): Promise<void> {
    let permissions: string[] = [];
    try {
      const response = await firstValueFrom(
        this.auth.evaluatePermissions(VOTING_ADMIN_PERMISSIONS),
      );
      permissions = response.permissions;
    } catch {
      // Token grants remain available if the policy lookup fails.
    }

    if (this.auth.user() === user) {
      this.evaluatedPermissions.set(permissions);
    }
  }
}
