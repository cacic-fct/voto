import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { PollResults, PollResultsResponse } from '@org/voting-contracts';
import { AdminResultsChartComponent, AdminResultsChartConfig } from './admin-results-chart.component';
import {
  QuestionResultSummary,
  ResultsVoterRow,
  SelectedIndividualAnswer,
  responseVoterLabel,
} from './admin-poll-results';
import { PollBuilderDraftService } from './poll-builder-draft.service';

@Component({
  selector: 'app-admin-poll-results-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTabsModule,
    AdminResultsChartComponent,
  ],
  templateUrl: './admin-poll-results-panel.component.html',
  styleUrl: './admin-poll-builder-page.component.scss',
})
export class AdminPollResultsPanelComponent {
  readonly builder = input.required<PollBuilderDraftService>();
  readonly loadingResults = input(false);
  readonly results = input<PollResults | null>(null);
  readonly individualResultsAvailable = input(false);
  readonly voterRows = input<ResultsVoterRow[]>([]);
  readonly demographicsCharts = input<AdminResultsChartConfig[]>([]);
  readonly answerSummaryCharts = input<AdminResultsChartConfig[]>([]);
  readonly textQuestionSummaries = input<QuestionResultSummary[]>([]);
  readonly questionSummaries = input<QuestionResultSummary[]>([]);
  readonly selectedQuestionElementId = input<string | null>(null);
  readonly selectedQuestionSummary = input<QuestionResultSummary | null>(null);
  readonly selectedIndividualResponse = input<PollResultsResponse | null>(null);
  readonly selectedIndividualAnswers = input<SelectedIndividualAnswer[]>([]);
  readonly selectedResultsElementChange = output<MatSelectChange>();
  readonly selectedIndividualResponseChange = output<MatSelectChange>();

  protected responseVoterLabel(response: PollResultsResponse): string {
    return responseVoterLabel(response);
  }
}
