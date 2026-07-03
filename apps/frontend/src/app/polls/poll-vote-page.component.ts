import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { CacicElectionSlateFormComponent } from './cacic-election-slate-form.component';
import { PollDescriptionContentComponent } from './poll-description-content.component';
import { PollVotePageLoader } from './poll-vote-page-loader';

@Component({
  selector: 'app-poll-vote-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSelectModule,
    MatSnackBarModule,
    CacicElectionSlateFormComponent,
    PollDescriptionContentComponent,
  ],
  templateUrl: './poll-vote-page.component.html',
  styleUrl: './poll-vote-page.component.scss',
})
export class PollVotePageComponent extends PollVotePageLoader implements OnDestroy {
  ngOnDestroy(): void {
    this.closeResultsEvents();
  }
}
