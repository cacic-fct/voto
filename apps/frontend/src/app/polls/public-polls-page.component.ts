import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { PollSummary } from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { voterEligibilityLabel, votingStyleLabel } from './poll-metadata';
import { PollApiService } from './poll-api.service';

@Component({
  selector: 'app-public-polls-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatProgressBarModule],
  templateUrl: './public-polls-page.component.html',
  styleUrl: './public-polls-page.component.scss',
})
export class PublicPollsPageComponent {
  private readonly api = inject(PollApiService);
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  protected readonly polls = signal<PollSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly votingStyleLabel = votingStyleLabel;
  protected readonly voterEligibilityLabel = voterEligibilityLabel;

  protected pollStatusLabel(poll: PollSummary): string {
    if (poll.status === 'closed') {
      return 'Encerrada';
    }

    return poll.publishedAt ? `Publicada em ${this.dateTimeFormatter.format(new Date(poll.publishedAt))}` : 'Publicada';
  }

  constructor() {
    void this.loadPolls();
  }

  private async loadPolls(): Promise<void> {
    try {
      this.polls.set(await firstValueFrom(this.api.listPublicPolls()));
    } catch {
      this.error.set('Não foi possível carregar as votações.');
    } finally {
      this.loading.set(false);
    }
  }
}
