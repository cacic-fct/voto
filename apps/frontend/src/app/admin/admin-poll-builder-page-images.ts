import { PollImage } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { AdminPollBuilderPageResults } from './admin-poll-builder-page-results';

export abstract class AdminPollBuilderPageImages extends AdminPollBuilderPageResults {
  protected async uploadPollDescriptionImage(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    const pollId = await this.ensurePollSavedForImages();
    if (!pollId) {
      return;
    }

    this.uploadingImageTarget.set('poll');
    try {
      const image = await firstValueFrom(this.api.uploadPollImage(pollId, file));
      this.builder.addPollDescriptionImage(image);
      await this.persistCurrentDraftAfterImageChange(pollId);
      this.snackBar.open('Imagem adicionada à descrição.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível enviar a imagem.', 'OK', { duration: 4000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async uploadElementDescriptionImage(elementId: string, file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    const pollId = await this.ensurePollSavedForImages();
    if (!pollId) {
      return;
    }

    this.uploadingImageTarget.set(elementId);
    try {
      const image = await firstValueFrom(this.api.uploadPollImage(pollId, file));
      this.builder.addElementDescriptionImage(elementId, image);
      await this.persistCurrentDraftAfterImageChange(pollId);
      this.snackBar.open('Imagem adicionada ao item.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível enviar a imagem.', 'OK', { duration: 4000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async removePollDescriptionImage(image: PollImage): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.builder.removePollDescriptionImage(image.id);
      return;
    }

    this.uploadingImageTarget.set('poll');
    try {
      await firstValueFrom(this.api.deletePollImage(pollId, image.id));
      this.builder.removePollDescriptionImage(image.id);
      this.snackBar.open('Imagem removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a imagem.', 'OK', { duration: 3000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  protected async removeElementDescriptionImage(elementId: string, image: PollImage): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.builder.removeElementDescriptionImage(elementId, image.id);
      return;
    }

    this.uploadingImageTarget.set(elementId);
    try {
      await firstValueFrom(this.api.deletePollImage(pollId, image.id));
      this.builder.removeElementDescriptionImage(elementId, image.id);
      this.snackBar.open('Imagem removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a imagem.', 'OK', { duration: 3000 });
    } finally {
      this.uploadingImageTarget.set(null);
    }
  }

  private async ensurePollSavedForImages(): Promise<string | null> {
    const draft = this.builder.draft();
    if (draft.id) {
      return draft.id;
    }

    if (!this.builder.canSave()) {
      this.snackBar.open('Informe o título da votação antes de enviar imagens.', 'OK', { duration: 3500 });
      return null;
    }

    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.createPoll(this.builder.toSaveRequest(draft)));
      this.builder.setDraft(saved);
      await this.loadPolls(false);
      return saved.id;
    } catch {
      this.snackBar.open('Não foi possível salvar a votação antes do envio.', 'OK', { duration: 4000 });
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private async persistCurrentDraftAfterImageChange(pollId: string): Promise<void> {
    const saved = await firstValueFrom(this.api.updatePoll(pollId, this.builder.toSaveRequest()));
    this.builder.setDraft(saved);
    await this.loadPolls(false);
  }
}
