import { ChangeDetectionStrategy, Component, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PollStatus } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { CacicElectionSlateFormComponent } from '../polls/cacic-election-slate-form.component';
import { PollDescriptionContentComponent } from '../polls/poll-description-content.component';
import { AdminPollBuilderPageSlates } from './admin-poll-builder-page-slates';
import { AdminPollElementsEditorComponent } from './admin-poll-elements-editor.component';
import { AdminPollResultsPanelComponent } from './admin-poll-results-panel.component';
import { PollBuilderDraftService } from './poll-builder-draft.service';

@Component({
  selector: 'app-admin-poll-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    AdminPollElementsEditorComponent,
    AdminPollResultsPanelComponent,
    CacicElectionSlateFormComponent,
    PollDescriptionContentComponent,
  ],
  providers: [PollBuilderDraftService],
  templateUrl: './admin-poll-builder-page.component.html',
  styleUrl: './admin-poll-builder-page.component.scss',
})
export class AdminPollBuilderPageComponent extends AdminPollBuilderPageSlates implements OnDestroy {
  constructor() {
    super();
    void this.loadPolls();
    void this.loadLinkableEvents();
  }

  ngOnDestroy(): void {
    this.closeResultsEvents();
  }

  protected async selectPoll(id: string): Promise<void> {
    this.saving.set(true);
    this.resetResults();
    try {
      this.builder.setDraft(await firstValueFrom(this.api.getAdminPoll(id)));
      await this.loadEligibilityEnrollments(false);
      await this.loadCacicElectionSlates(false);
      await this.loadResults(false);
    } catch {
      this.snackBar.open('Não foi possível abrir a votação.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (!this.builder.canSave()) {
      this.snackBar.open('Informe o título da votação.', 'OK', { duration: 3000 });
      return;
    }

    this.saving.set(true);
    try {
      const draft = this.builder.draft();
      const request = this.builder.toSaveRequest(draft);
      const saved = draft.id
        ? await firstValueFrom(this.api.updatePoll(draft.id, request))
        : await firstValueFrom(this.api.createPoll(request));
      this.builder.setDraft(saved);
      await this.loadEligibilityEnrollments(false);
      await this.loadCacicElectionSlates(false);
      await this.loadResults(false);
      await this.loadPolls(false);
      this.snackBar.open('Votação salva.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível salvar. Confira os itens e opções.', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async setStatus(status: PollStatus): Promise<void> {
    const id = this.builder.draft().id;
    if (!id) {
      return;
    }

    this.saving.set(true);
    try {
      this.builder.setDraft(await firstValueFrom(this.api.updatePollStatus(id, status)));
      await this.loadCacicElectionSlates(false);
      await this.loadPolls(false);
      this.snackBar.open('Status atualizado.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível atualizar o status.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async deletePoll(): Promise<void> {
    const id = this.builder.draft().id;
    if (!id || !globalThis.confirm('Excluir esta votação e todas as respostas?')) {
      return;
    }

    this.saving.set(true);
    try {
      await firstValueFrom(this.api.deletePoll(id));
      this.builder.newPoll();
      this.resetResults();
      await this.loadPolls(false);
      this.snackBar.open('Votação excluída.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível excluir a votação.', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }
}
