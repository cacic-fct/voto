import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import { firstValueFrom } from 'rxjs';
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
export class PollKioskPageComponent {
  private readonly api = inject(PollApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly pollId = this.route.snapshot.paramMap.get('id')?.trim() ?? '';
  protected readonly poll = signal<Poll | null>(null);
  protected readonly loading = signal(true);
  protected readonly authorizing = signal(false);
  protected readonly error = signal<string | null>(
    this.initialReturnMessage(),
  );
  protected readonly voteRegistered =
    this.route.snapshot.queryParamMap.get('registered') === '1';
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

  constructor() {
    void this.loadPoll();
  }

  protected async authorize(): Promise<void> {
    if (!this.canAuthorize()) {
      this.form.markAllAsTouched();
      return;
    }

    this.authorizing.set(true);
    this.error.set(null);
    try {
      const value = this.form.getRawValue();
      await firstValueFrom(
        this.api.authorizeKioskVote(this.pollId, {
          primaryEmail: value.primaryEmail.trim(),
          totpCode: value.totpCode,
        }),
      );
      this.form.reset();
      await this.router.navigate(
        ['/admin/polls', this.pollId, 'kiosk', 'vote'],
        { replaceUrl: true },
      );
    } catch (error) {
      this.form.controls.totpCode.reset();
      this.error.set(this.authorizationError(error));
    } finally {
      this.authorizing.set(false);
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

  private async loadPoll(): Promise<void> {
    if (!this.pollId) {
      this.error.set('Votação não encontrada.');
      this.loading.set(false);
      return;
    }
    try {
      this.poll.set(await firstValueFrom(this.api.getAdminPoll(this.pollId)));
    } catch {
      this.error.set('Não foi possível abrir o modo quiosque desta votação.');
    } finally {
      this.loading.set(false);
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

  private initialReturnMessage(): string | null {
    switch (this.route.snapshot.queryParamMap.get('reason')) {
      case 'expired':
        return 'A autorização expirou. Identifique a pessoa novamente para continuar.';
      case 'submit':
        return 'O voto não foi registrado. Identifique a pessoa novamente antes de tentar outra vez.';
      default:
        return null;
    }
  }
}
