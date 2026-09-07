import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Poll } from '@org/voting-contracts';
import { firstValueFrom, of } from 'rxjs';
import { PollApiService } from '../polls/poll-api.service';

@Component({
  selector: 'app-poll-kiosk-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './poll-kiosk-page.component.html',
  styleUrl: './poll-kiosk-page.component.scss',
})
export class PollKioskPageComponent implements OnDestroy {
  private readonly api = inject(PollApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly routeParamMap = toSignal(
    this.route.paramMap ?? of(this.route.snapshot.paramMap),
    { initialValue: this.route.snapshot.paramMap },
  );
  private readonly routeQueryParamMap = toSignal(
    this.route.queryParamMap ?? of(this.route.snapshot.queryParamMap),
    { initialValue: this.route.snapshot.queryParamMap },
  );
  protected readonly pollId = computed(() => this.routeParamMap().get('id')?.trim() ?? '');
  protected readonly poll = signal<Poll | null>(null);
  protected readonly loading = signal(true);
  protected readonly authorizing = signal(false);
  protected readonly error = signal<string | null>(
    this.initialReturnMessage(),
  );
  protected readonly voteRegistered = computed(() => this.routeQueryParamMap().get('registered') === '1');
  protected readonly form = new FormGroup({
    primaryEmail: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(254)],
    }),
    totpCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
    }),
  });
  private readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });
  protected readonly canAuthorize = computed(
    () =>
      !this.authorizing() &&
      this.formStatus() === 'VALID' &&
      Boolean(this.poll()),
  );
  private loadGeneration = 0;

  constructor() {
    effect(() => {
      const pollId = this.pollId();
      void this.loadPoll(pollId);
    });
  }

  ngOnDestroy(): void {
    this.loadGeneration += 1;
  }

  protected async authorize(): Promise<void> {
    const generation = this.loadGeneration;
    const pollId = this.pollId();
    if (!pollId) {
      return;
    }

    if (!this.canAuthorize()) {
      this.form.markAllAsTouched();
      return;
    }

    this.authorizing.set(true);
    this.error.set(null);
    try {
      const value = this.form.getRawValue();
      await firstValueFrom(
        this.api.authorizeKioskVote(pollId, {
          primaryEmail: value.primaryEmail.trim(),
          totpCode: value.totpCode,
        }),
      );
      if (generation !== this.loadGeneration || pollId !== this.pollId()) {
        return;
      }
      this.form.reset();
      await this.router.navigate(
        ['/admin/polls', pollId, 'kiosk', 'vote'],
        { replaceUrl: true },
      );
    } catch (error) {
      if (generation === this.loadGeneration && pollId === this.pollId()) {
        this.form.controls.totpCode.reset();
        this.error.set(this.authorizationError(error));
      }
    } finally {
      if (generation === this.loadGeneration && pollId === this.pollId()) {
        this.authorizing.set(false);
      }
    }
  }

  protected normalizeTotpCode(event: Event): void {
    const input = event.target as HTMLInputElement;
    const code = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value !== code) {
      input.value = code;
    }
    this.form.controls.totpCode.setValue(code);
  }

  private async loadPoll(pollId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this.poll.set(null);
    this.error.set(this.initialReturnMessage(untracked(() => this.routeQueryParamMap())));
    this.loading.set(true);
    this.authorizing.set(false);
    this.form.reset();

    if (!pollId) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }
    try {
      const poll = await firstValueFrom(this.api.getAdminPoll(pollId));
      if (generation !== this.loadGeneration || pollId !== this.pollId()) {
        return;
      }
      this.poll.set(poll);
    } catch {
      if (generation === this.loadGeneration && pollId === this.pollId()) {
        this.error.set('Não foi possível abrir o modo quiosque desta votação.');
      }
    } finally {
      if (generation === this.loadGeneration && pollId === this.pollId()) {
        this.loading.set(false);
      }
    }
  }

  private authorizationError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 429) {
        return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
      }
      if (error.status === 409) {
        return 'Esta pessoa já votou ou a votação não está aceitando novos votos.';
      }
      if (error.status === 503) {
        return 'A validação está temporariamente indisponível. Tente novamente em instantes.';
      }
    }
    return 'E-mail principal ou código TOTP inválido.';
  }

  private initialReturnMessage(queryParamMap = this.routeQueryParamMap()): string | null {
    switch (queryParamMap.get('reason')) {
      case 'expired':
        return 'A autorização expirou. Identifique a pessoa novamente para continuar.';
      case 'submit':
        return 'O voto não foi registrado. Identifique a pessoa novamente antes de tentar outra vez.';
      default:
        return null;
    }
  }
}
