import { MatSelectChange } from '@angular/material/select';
import { PollResultsDelta, PollResultsResponse } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { responseVoterLabel } from './admin-poll-results';
import { AdminPollBuilderPageBase } from './admin-poll-builder-page-base';
import { reconcilePollResults } from '../polls/poll-results-reconciliation';

export abstract class AdminPollBuilderPageResults extends AdminPollBuilderPageBase {
  private resultsRefreshTimer?: ReturnType<typeof setTimeout>;
  private resultsRequestRevision = 0;
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

  protected async loadResults(
    showLoading = true,
    selectionGeneration = this.currentPollSelectionGeneration(),
  ): Promise<void> {
    const pollId = this.builder.draft().id;
    if (pollId && !this.isPollSelectionCurrent(selectionGeneration, pollId)) {
      return;
    }
    if (!pollId) {
      this.resetResults();
      return;
    }
    this.resultsRequestRevision += 1;

    if (showLoading) {
      this.loadingResults.set(true);
    }

    try {
      const results = await firstValueFrom(this.api.getAdminPollResults(pollId));
      if (!this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        return;
      }
      this.results.set(results);
      this.resultsFinalizationState.set('idle');
      this.resultsFinalizationError.set(null);
      this.pendingFinalResultsPollId.set(null);
      this.selectedResultsElementId.set(this.questionSummaries()[0]?.key ?? null);
      this.selectedIndividualResponseId.set(results.responses.find((response) => response.voter)?.id ?? null);
      this.openAdminResultsEvents(pollId, selectionGeneration);
    } catch {
      if (this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        this.snackBar.open('Não foi possível carregar os resultados.', 'OK', { duration: 3000 });
      }
    } finally {
      if (this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        this.loadingResults.set(false);
      }
    }
  }

  protected resetResults(): void {
    this.resultsRequestRevision += 1;
    this.closeResultsEvents();
    this.results.set(null);
    this.loadingResults.set(false);
    this.selectedResultsElementId.set(null);
    this.selectedIndividualResponseId.set(null);
    this.resultsFinalizationState.set('idle');
    this.resultsFinalizationError.set(null);
    this.pendingFinalResultsPollId.set(null);
  }

  protected retryFinalResults(): void {
    const pollId = this.pendingFinalResultsPollId();
    if (!pollId || this.builder.draft().id !== pollId) {
      return;
    }

    this.resultsFinalizationState.set('pending');
    this.resultsFinalizationError.set(null);
    void this.reconcileFinalResults(pollId, this.currentPollSelectionGeneration());
  }

  protected closeResultsEvents(): void {
    if (this.resultsRefreshTimer) {
      clearTimeout(this.resultsRefreshTimer);
      this.resultsRefreshTimer = undefined;
    }
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

  private openAdminResultsEvents(pollId: string, selectionGeneration: number): void {
    this.closeResultsEvents();
    if (!this.isBrowser) {
      return;
    }

    const source = this.api.openAdminPollResultsEvents(pollId);
    source.onmessage = (event) => {
      if (!this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        source.close();
        return;
      }
      const delta = this.api.parseResultsDelta(event);
      if (delta) {
        this.applyResultsDelta(delta);
        if (delta.final) {
          this.resultsRequestRevision += 1;
          this.pendingFinalResultsPollId.set(pollId);
          this.resultsFinalizationState.set('pending');
          this.resultsFinalizationError.set(null);
          void this.reconcileFinalResults(pollId, selectionGeneration);
        } else if (delta.refreshRequired) {
          this.scheduleResultsRefresh(pollId, selectionGeneration);
        }
      }
    };
    source.onopen = () => {
      if (!this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        source.close();
      }
    };
    source.onerror = () => {
      if (!this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        source.close();
      }
    };
    this.resultsEvents = source;
  }

  private scheduleResultsRefresh(pollId: string, selectionGeneration: number): void {
    if (this.resultsRefreshTimer) {
      return;
    }

    this.resultsRefreshTimer = setTimeout(() => {
      this.resultsRefreshTimer = undefined;
      if (!this.isPollSelectionCurrent(selectionGeneration, pollId)) {
        return;
      }
      const requestRevision = this.resultsRequestRevision;
      void firstValueFrom(this.api.getAdminPollResults(pollId))
        .then((results) => {
          if (
            this.isPollSelectionCurrent(selectionGeneration, pollId) &&
            requestRevision === this.resultsRequestRevision
          ) {
            this.results.set(results);
          }
        })
        .catch(() => {
          if (this.isPollSelectionCurrent(selectionGeneration, pollId)) {
            this.snackBar.open('A atualização dos resultados está temporariamente indisponível.', 'OK', { duration: 3000 });
          }
        });
    }, 250);
  }

  private applyResultsDelta(delta: PollResultsDelta): void {
    this.results.update((current) => {
      if (!current || current.pollId !== delta.pollId) {
        return current;
      }

      return {
        ...current,
        answersReleased: delta.answersReleased ?? current.answersReleased,
        responseCount: delta.responseCount,
        voterCount: delta.voterCount ?? current.voterCount,
        voters: delta.voters ?? current.voters,
        aggregates: delta.aggregates ?? current.aggregates,
        responses: delta.refreshRequired ? current.responses : delta.responses,
      };
    });

    if (!this.selectedIndividualResponseId()) {
      this.selectedIndividualResponseId.set(delta.responses.find((response) => response.voter)?.id ?? null);
    }
  }

  private async reconcileFinalResults(pollId: string, selectionGeneration: number): Promise<void> {
    await reconcilePollResults(
      () => firstValueFrom(this.api.getAdminPollResults(pollId)),
      {
        isCurrent: () => this.isPollSelectionCurrent(selectionGeneration, pollId),
        apply: (results) => {
          this.results.set(results);
          this.resultsFinalizationState.set('complete');
          this.resultsFinalizationError.set(null);
          this.closeResultsEvents();
        },
        fail: () => {
          this.resultsFinalizationState.set('failed');
          this.resultsFinalizationError.set('Os resultados finais ainda não estão disponíveis. Tente novamente.');
        },
      },
    );
  }
}
