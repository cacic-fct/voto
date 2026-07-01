import { MatSelectChange } from '@angular/material/select';
import { PollResultsDelta, PollResultsResponse } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { responseVoterLabel } from './admin-poll-results';
import { AdminPollBuilderPageBase } from './admin-poll-builder-page-base';

export abstract class AdminPollBuilderPageResults extends AdminPollBuilderPageBase {
  protected updateSelectedResultsElement(event: MatSelectChange): void {
    this.selectedResultsElementId.set(typeof event.value === 'string' ? event.value : null);
  }

  protected updateSelectedIndividualResponse(event: MatSelectChange): void {
    this.selectedIndividualResponseId.set(typeof event.value === 'string' ? event.value : null);
  }

  protected responseVoterLabel(response: PollResultsResponse): string {
    return responseVoterLabel(response);
  }

  protected async exportCacicElectionVoterEnrollments(): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId || !this.canExportCacicElectionVoters()) {
      return;
    }

    this.exportingCacicElectionVoters.set(true);
    try {
      const content = await firstValueFrom(this.api.exportCacicElectionVoterEnrollments(pollId));
      this.saveTextFile(content, `matriculas-votantes-${pollId}.txt`);
      this.snackBar.open('Arquivo de matrículas gerado.', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Não foi possível baixar as matrículas dos votantes.', 'OK', { duration: 3500 });
    } finally {
      this.exportingCacicElectionVoters.set(false);
    }
  }

  protected async loadResults(showLoading = true): Promise<void> {
    const pollId = this.builder.draft().id;
    if (!pollId) {
      this.resetResults();
      return;
    }

    if (showLoading) {
      this.loadingResults.set(true);
    }

    try {
      const results = await firstValueFrom(this.api.getAdminPollResults(pollId));
      this.results.set(results);
      this.selectedResultsElementId.set(this.questionSummaries()[0]?.key ?? null);
      this.selectedIndividualResponseId.set(results.responses.find((response) => response.voter)?.id ?? null);
      this.openAdminResultsEvents(pollId);
    } catch {
      this.snackBar.open('Não foi possível carregar os resultados.', 'OK', { duration: 3000 });
    } finally {
      this.loadingResults.set(false);
    }
  }

  protected resetResults(): void {
    this.closeResultsEvents();
    this.results.set(null);
    this.loadingResults.set(false);
    this.selectedResultsElementId.set(null);
    this.selectedIndividualResponseId.set(null);
  }

  protected closeResultsEvents(): void {
    this.resultsEvents?.close();
    this.resultsEvents = undefined;
  }

  private saveTextFile(content: Blob, filename: string): void {
    if (!this.isBrowser) {
      return;
    }

    const url = globalThis.URL.createObjectURL(content);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    globalThis.URL.revokeObjectURL(url);
  }

  private openAdminResultsEvents(pollId: string): void {
    this.closeResultsEvents();
    if (!this.isBrowser) {
      return;
    }

    const source = this.api.openAdminPollResultsEvents(pollId, 0);
    source.onmessage = (event) => {
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
      }
    };
    this.resultsEvents = source;
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => {
      if (!current || current.pollId !== delta.pollId) {
        return current;
      }

      const existingResponses = new Map(current.responses.map((response) => [response.id, response]));
      for (const response of delta.responses) {
        existingResponses.set(response.id, response);
      }

      return {
        ...current,
        responseCount: delta.responseCount,
        responses: [...existingResponses.values()],
      };
    });

    if (!this.selectedIndividualResponseId()) {
      this.selectedIndividualResponseId.set(delta.responses.find((response) => response.voter)?.id ?? null);
    }
  }
}
