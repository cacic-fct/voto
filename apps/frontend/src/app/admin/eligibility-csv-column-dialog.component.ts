import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';

export type EligibilityCsvColumnDialogData = {
  fileName: string;
  headers: string[];
  previewRows: Record<string, string>[];
};

@Component({
  selector: 'app-eligibility-csv-column-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatListModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Importar matrículas</h2>
    <div mat-dialog-content class="dialog-content">
      <p class="file-name">Arquivo: {{ data.fileName }}</p>
      <form class="column-form" [formGroup]="form">
        <mat-form-field appearance="outline">
          <mat-label>Coluna de matrícula</mat-label>
          <mat-select formControlName="selectedHeader">
            @for (header of data.headers; track header) {
              <mat-option [value]="header">{{ header }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </form>

      @if (previewValues().length > 0) {
        <section class="preview-section" aria-labelledby="preview-title">
          <h3 id="preview-title">Prévia da coluna</h3>
          <mat-list class="preview-list" aria-label="Prévia de matrículas">
            @for (value of previewValues(); track value) {
              <mat-list-item>
                <span matListItemTitle>{{ value }}</span>
              </mat-list-item>
            }
          </mat-list>
        </section>
      } @else {
        <p class="empty-note">Nenhum valor de matrícula encontrado na coluna selecionada.</p>
      }
    </div>
    <div mat-dialog-actions align="end" class="dialog-actions">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button type="button" [disabled]="form.invalid" (click)="confirm()">
        <mat-icon>upload_file</mat-icon>
        Importar
      </button>
    </div>
  `,
  styles: `
    .dialog-content,
    .column-form,
    .preview-section {
      display: grid;
      gap: 0.75rem;
    }

    .dialog-content {
      min-width: min(28rem, calc(100vw - 4rem));
    }

    .file-name,
    .empty-note,
    .preview-section h3 {
      margin: 0;
    }

    .file-name,
    .empty-note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      overflow-wrap: anywhere;
    }

    mat-form-field {
      width: 100%;
    }

    .preview-section h3 {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-small);
    }

    .preview-list {
      max-height: 14rem;
      overflow: auto;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }

    .dialog-actions {
      gap: 0.5rem;
    }

    @media (max-width: 600px) {
      .dialog-content {
        min-width: 0;
      }

      .dialog-actions {
        justify-content: stretch;
      }

      .dialog-actions button {
        flex: 1 1 auto;
      }
    }
  `,
})
export class EligibilityCsvColumnDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EligibilityCsvColumnDialogComponent, string | null>);
  private readonly formBuilder = inject(FormBuilder);
  readonly data = inject<EligibilityCsvColumnDialogData>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    selectedHeader: [this.data.headers[0] ?? '', [Validators.required]],
  });

  private readonly selectedHeader = toSignal(
    this.form.controls.selectedHeader.valueChanges.pipe(startWith(this.form.controls.selectedHeader.value)),
    { initialValue: this.form.controls.selectedHeader.value },
  );

  readonly previewValues = computed(() => {
    const selectedHeader = this.selectedHeader();
    return this.data.previewRows
      .map((row) => row[selectedHeader]?.trim() ?? '')
      .filter((value) => value.length > 0)
      .slice(0, 8);
  });

  confirm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(this.form.controls.selectedHeader.value);
  }
}
