import {
  AdminCacicElectionSlate,
  SubmitCacicElectionSlateRequest,
  UpdateCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { CacicElectionSlateRejectionDialogComponent } from './cacic-election-slate-rejection-dialog.component';
import { AdminPollBuilderPageEligibility } from './admin-poll-builder-page-eligibility';

export abstract class AdminPollBuilderPageSlates extends AdminPollBuilderPageEligibility {
  protected async saveSlate(request: SubmitCacicElectionSlateRequest | UpdateCacicElectionSlateRequest): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.snackBar.open('Salve a eleição antes de cadastrar chapas.', 'OK', { duration: 3000 });
      return;
    }

    const editingSlate = this.editingSlate();
    const payload: UpdateCacicElectionSlateRequest = {
      ...request,
      status: editingSlate?.status ?? 'approved',
      enabled: editingSlate?.enabled ?? true,
    };
    this.savingSlate.set(true);
    try {
      const savedSlate = editingSlate
        ? await firstValueFrom(this.api.updateAdminCacicElectionSlate(pollId, editingSlate.id, payload))
        : await firstValueFrom(this.api.createAdminCacicElectionSlate(pollId, payload));
      this.slates.update((slates) =>
        editingSlate
          ? slates.map((slate) => (slate.id === savedSlate.id ? savedSlate : slate))
          : [...slates, savedSlate],
      );
      this.editingSlate.set(null);
      await this.reloadPollAfterSlateChange(pollId);
      this.snackBar.open('Chapa salva.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível salvar a chapa.', 'OK', { duration: 4000 });
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected editSlate(slate: AdminCacicElectionSlate): void {
    this.editingSlate.set(slate);
  }

  protected cancelSlateEdit(): void {
    this.editingSlate.set(null);
  }

  protected async approveSlate(slate: AdminCacicElectionSlate): Promise<void> {
    await this.updateSlate(slate, { status: 'approved', enabled: true });
  }

  protected async updateSlateEnabled(slate: AdminCacicElectionSlate, enabled: boolean): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      return;
    }

    this.savingSlate.set(true);
    try {
      const updated = await firstValueFrom(this.api.updateCacicElectionSlateEnabled(pollId, slate.id, { enabled }));
      this.replaceSlate(updated);
      await this.reloadPollAfterSlateChange(pollId);
      this.snackBar.open(enabled ? 'Chapa habilitada.' : 'Chapa desabilitada.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível atualizar a chapa.', 'OK', { duration: 3000 });
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected async rejectSlate(slate: AdminCacicElectionSlate): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      return;
    }

    const reason = await firstValueFrom(
      this.dialog.open(CacicElectionSlateRejectionDialogComponent, {
        width: 'min(36rem, 96vw)',
      }).afterClosed(),
    );
    if (!reason) {
      return;
    }

    this.savingSlate.set(true);
    try {
      const updated = await firstValueFrom(this.api.rejectCacicElectionSlate(pollId, slate.id, { reason }));
      this.replaceSlate(updated);
      await this.reloadPollAfterSlateChange(pollId);
      this.snackBar.open('Chapa rejeitada.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível rejeitar a chapa.', 'OK', { duration: 3000 });
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected async deleteSlate(slate: AdminCacicElectionSlate): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId || !globalThis.confirm(`Excluir a chapa "${slate.name}"?`)) {
      return;
    }

    this.savingSlate.set(true);
    try {
      await firstValueFrom(this.api.deleteCacicElectionSlate(pollId, slate.id));
      this.slates.update((slates) => slates.filter((item) => item.id !== slate.id));
      if (this.editingSlate()?.id === slate.id) {
        this.editingSlate.set(null);
      }
      await this.reloadPollAfterSlateChange(pollId);
      this.snackBar.open('Chapa excluída.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível excluir a chapa.', 'OK', { duration: 3000 });
    } finally {
      this.savingSlate.set(false);
    }
  }

  protected slateStatusLabel(status: AdminCacicElectionSlate['status']): string {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'approved':
        return 'Aprovada';
      case 'rejected':
        return 'Rejeitada';
    }
  }

  protected slateRoleLabel(role: AdminCacicElectionSlate['members'][number]['role'], customRole?: string): string {
    switch (role) {
      case 'president':
        return 'Presidente';
      case 'vicePresident':
        return 'Vice-Presidente';
      case 'financialDirector':
        return 'Diretor Financeiro';
      case 'communicationDirector':
        return 'Diretor de Comunicação';
      case 'eventsDirector':
        return 'Diretor de Eventos';
      case 'publicRelationsDirector':
        return 'Diretor de Relações Públicas';
      case 'other':
        return customRole || 'Outro';
    }
  }

  protected slateIdentifierLabel(member: AdminCacicElectionSlate['members'][number]): string {
    switch (member.identifierType) {
      case 'cpf':
        return `CPF ${member.identifierValue}`;
      case 'phone':
        return `Telefone ${member.identifierValue}`;
      case 'email':
        return `E-mail ${member.identifierValue}`;
    }
  }

  protected async loadCacicElectionSlates(showLoading = true): Promise<void> {
    const poll = this.builder.draft();
    if (!poll.id || !this.builder.isCacicElection(poll)) {
      this.slates.set([]);
      this.editingSlate.set(null);
      return;
    }

    if (showLoading) {
      this.loadingSlates.set(true);
    }

    try {
      this.slates.set(await firstValueFrom(this.api.listAdminCacicElectionSlates(poll.id)));
    } catch {
      this.snackBar.open('Não foi possível carregar as chapas.', 'OK', { duration: 3000 });
    } finally {
      this.loadingSlates.set(false);
    }
  }

  private async updateSlate(
    slate: AdminCacicElectionSlate,
    overrides: Partial<UpdateCacicElectionSlateRequest>,
  ): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      return;
    }

    this.savingSlate.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.updateAdminCacicElectionSlate(pollId, slate.id, {
          ...this.toSlateUpdateRequest(slate),
          ...overrides,
        }),
      );
      this.replaceSlate(updated);
      await this.reloadPollAfterSlateChange(pollId);
      this.snackBar.open('Chapa atualizada.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível atualizar a chapa.', 'OK', { duration: 3000 });
    } finally {
      this.savingSlate.set(false);
    }
  }

  private replaceSlate(updated: AdminCacicElectionSlate): void {
    this.slates.update((slates) => slates.map((slate) => (slate.id === updated.id ? updated : slate)));
    if (this.editingSlate()?.id === updated.id) {
      this.editingSlate.set(updated);
    }
  }

  private toSlateUpdateRequest(slate: AdminCacicElectionSlate): UpdateCacicElectionSlateRequest {
    return {
      name: slate.name,
      status: slate.status,
      enabled: slate.enabled,
      members: slate.members.map((member) => ({
        fullName: member.fullName,
        ...(member.enrollmentNumber ? { enrollmentNumber: member.enrollmentNumber } : {}),
        role: member.role,
        ...(member.customRole ? { customRole: member.customRole } : {}),
        isRepresentative: member.isRepresentative,
        identifierType: member.identifierType,
        identifierValue: member.identifierValue,
      })),
    };
  }

  private async reloadPollAfterSlateChange(pollId: string): Promise<void> {
    const poll = await firstValueFrom(this.api.getAdminPoll(pollId));
    this.builder.setDraft(poll);
    this.selectedResultsElementId.set(this.questionSummaries()[0]?.key ?? null);
  }
}
