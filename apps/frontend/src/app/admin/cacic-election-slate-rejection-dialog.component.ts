import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-cacic-election-slate-rejection-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Rejeitar chapa</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Motivo</mat-label>
        <textarea matInput rows="4" [value]="reason()" (input)="updateReason($event)"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <button mat-flat-button type="button" [disabled]="!reason().trim()" (click)="confirm()">Rejeitar</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: min(32rem, 100%);
    }
  `,
})
export class CacicElectionSlateRejectionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<CacicElectionSlateRejectionDialogComponent, string>);
  protected readonly reason = signal('');

  protected updateReason(event: Event): void {
    const target = event.target;
    this.reason.set(target instanceof HTMLTextAreaElement ? target.value : '');
  }

  protected confirm(): void {
    const reason = this.reason().trim();
    if (reason) {
      this.dialogRef.close(reason);
    }
  }
}
