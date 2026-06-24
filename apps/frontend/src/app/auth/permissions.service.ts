import { Injectable, computed, inject, signal } from '@angular/core';
import { VOTING_ADMIN_PERMISSIONS, hasVotingAdminPermission } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly auth = inject(AuthService);
  private readonly evaluatedPermissions = signal<Set<string>>(new Set());
  private evaluationPromise: Promise<void> | null = null;

  readonly rawPermissions = computed(() => {
    const permissions = new Set(this.auth.permissions());
    for (const permission of this.evaluatedPermissions()) {
      permissions.add(permission);
    }

    return [...permissions].sort();
  });

  readonly isAdmin = computed(() => hasVotingAdminPermission(this.rawPermissions(), this.auth.roles()));

  async evaluateAdminPermissions(): Promise<void> {
    if (!this.auth.isAuthenticated() || this.evaluationPromise) {
      return this.evaluationPromise ?? undefined;
    }

    this.evaluationPromise = this.fetchAdminPermissions();
    try {
      await this.evaluationPromise;
    } finally {
      this.evaluationPromise = null;
    }
  }

  private async fetchAdminPermissions(): Promise<void> {
    try {
      const response = await firstValueFrom(this.auth.evaluatePermissions(VOTING_ADMIN_PERMISSIONS));
      this.evaluatedPermissions.set(new Set(response.permissions));
    } catch {
      this.evaluatedPermissions.set(new Set());
    }
  }
}
