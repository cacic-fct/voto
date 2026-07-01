import { PollEligibilityEnrollment, PollEligibilityMutationMode } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { parseCsv } from './csv-parser';
import { EligibilityCsvColumnDialogComponent } from './eligibility-csv-column-dialog.component';
import { AdminPollBuilderPageImages } from './admin-poll-builder-page-images';

export abstract class AdminPollBuilderPageEligibility extends AdminPollBuilderPageImages {
  protected async addManualEnrollmentNumbers(): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.snackBar.open('Salve a votação antes de adicionar matrículas.', 'OK', { duration: 3000 });
      return;
    }

    const enrollmentNumbers = this.manualEnrollmentNumbers()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (enrollmentNumbers.length === 0) {
      this.snackBar.open('Informe pelo menos uma matrícula.', 'OK', { duration: 3000 });
      return;
    }

    this.importingEligibility.set(true);
    try {
      const result = await firstValueFrom(this.api.addPollEligibilityEnrollments(pollId, { enrollmentNumbers }));
      this.eligibilityEntries.set(result.entries);
      this.manualEnrollmentNumbers.set('');
      this.snackBar.open(this.importResultLabel(result.createdCount, result.existingCount), 'OK', { duration: 3500 });
    } catch {
      this.snackBar.open('Não foi possível adicionar as matrículas.', 'OK', { duration: 4000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async importEligibilityFile(file: File | null, mode: PollEligibilityMutationMode): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!file || !pollId) {
      if (!pollId) {
        this.snackBar.open('Salve a votação antes de importar matrículas.', 'OK', { duration: 3000 });
      }
      return;
    }

    this.importingEligibility.set(true);
    try {
      const content = await file.text();
      const format = this.detectEligibilityFileFormat(file);
      const selectedHeader = format === 'csv' ? await this.selectCsvHeader(file.name, content) : undefined;
      if (format === 'csv' && !selectedHeader) {
        return;
      }

      const result = await firstValueFrom(
        this.api.importPollEligibilityEnrollments(pollId, {
          content,
          fileName: file.name,
          format,
          mode,
          selectedHeader,
        }),
      );
      this.eligibilityEntries.set(result.entries);
      this.snackBar.open(this.importResultLabel(result.createdCount, result.existingCount, mode), 'OK', {
        duration: 4000,
      });
    } catch {
      this.snackBar.open('Não foi possível importar o arquivo.', 'OK', { duration: 4000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async deleteEligibilityEnrollment(enrollmentNumber: string): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      return;
    }

    this.importingEligibility.set(true);
    try {
      await firstValueFrom(this.api.deletePollEligibilityEnrollment(pollId, enrollmentNumber));
      this.eligibilityEntries.update((entries) =>
        entries.filter((entry) => entry.enrollmentNumber !== enrollmentNumber),
      );
      this.snackBar.open('Matrícula removida.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível remover a matrícula.', 'OK', { duration: 3000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected async clearEligibilityEnrollments(): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId || !globalThis.confirm('Remover todas as matrículas habilitadas nesta votação?')) {
      return;
    }

    this.importingEligibility.set(true);
    try {
      const result = await firstValueFrom(this.api.clearPollEligibilityEnrollments(pollId));
      this.eligibilityEntries.set(result.entries);
      this.snackBar.open('Lista de matrículas limpa.', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Não foi possível limpar a lista.', 'OK', { duration: 3000 });
    } finally {
      this.importingEligibility.set(false);
    }
  }

  protected peopleLabel(entry: PollEligibilityEnrollment): string {
    if (entry.people.length === 0) {
      return 'Nenhum usuário encontrado';
    }

    return entry.people.map((person) => person.name).join(', ');
  }

  protected async loadEligibilityEnrollments(showLoading = true): Promise<void> {
    const poll = this.builder.draft();
    if (!poll.id || poll.voterEligibilitySource !== 'enrollmentList') {
      this.eligibilityEntries.set([]);
      return;
    }

    if (showLoading) {
      this.loadingEligibility.set(true);
    }

    try {
      const result = await firstValueFrom(this.api.listPollEligibilityEnrollments(poll.id));
      this.eligibilityEntries.set(result.entries);
    } catch {
      this.snackBar.open('Não foi possível carregar as matrículas habilitadas.', 'OK', { duration: 3000 });
    } finally {
      this.loadingEligibility.set(false);
    }
  }

  private detectEligibilityFileFormat(file: File): 'csv' | 'txt' {
    const fileName = file.name.toLowerCase();
    return file.type.includes('csv') || fileName.endsWith('.csv') ? 'csv' : 'txt';
  }

  private async selectCsvHeader(fileName: string, content: string): Promise<string | undefined> {
    const parsedCsv = parseCsv(content);
    const dialogRef = this.dialog.open(EligibilityCsvColumnDialogComponent, {
      width: '32rem',
      data: {
        fileName,
        headers: parsedCsv.headers,
        previewRows: parsedCsv.rows.slice(0, 12),
      },
    });

    return (await firstValueFrom(dialogRef.afterClosed())) ?? undefined;
  }

  private importResultLabel(
    createdCount: number,
    existingCount: number,
    mode: PollEligibilityMutationMode = 'append',
  ): string {
    if (mode === 'replace') {
      return `Lista substituída com ${createdCount} matrículas.`;
    }

    if (existingCount > 0) {
      return `${createdCount} matrículas adicionadas; ${existingCount} já estavam na lista.`;
    }

    return `${createdCount} matrículas adicionadas.`;
  }
}
