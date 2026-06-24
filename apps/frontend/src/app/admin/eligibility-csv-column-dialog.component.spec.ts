import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EligibilityCsvColumnDialogComponent,
  EligibilityCsvColumnDialogData,
} from './eligibility-csv-column-dialog.component';

describe('EligibilityCsvColumnDialogComponent', () => {
  let fixture: ComponentFixture<EligibilityCsvColumnDialogComponent>;
  let dialogRef: Pick<MatDialogRef<EligibilityCsvColumnDialogComponent, string | null>, 'close'>;

  const data: EligibilityCsvColumnDialogData = {
    fileName: 'matriculas.csv',
    headers: ['nome', 'matricula', 'email'],
    previewRows: [
      { nome: 'Ana', matricula: '123', email: 'ana@unesp.br' },
      { nome: 'Bruno', matricula: '456', email: 'bruno@unesp.br' },
      { nome: 'Sem matrícula', matricula: ' ', email: 'sem@unesp.br' },
    ],
  };

  beforeEach(async () => {
    dialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [EligibilityCsvColumnDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EligibilityCsvColumnDialogComponent);
    fixture.detectChanges();
  });

  it('selects the first header and previews non-empty values by default', () => {
    expect(fixture.componentInstance.form.controls.selectedHeader.value).toBe('nome');
    expect(fixture.componentInstance.previewValues()).toEqual(['Ana', 'Bruno', 'Sem matrícula']);
    expect(fixture.nativeElement.textContent).toContain('matriculas.csv');
  });

  it('updates preview values when the selected header changes', () => {
    fixture.componentInstance.form.controls.selectedHeader.setValue('matricula');

    expect(fixture.componentInstance.previewValues()).toEqual(['123', '456']);
  });

  it('closes with the selected header when the form is valid', () => {
    fixture.componentInstance.form.controls.selectedHeader.setValue('email');

    fixture.componentInstance.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith('email');
  });

  it('marks the form as touched instead of closing when invalid', () => {
    fixture.componentInstance.form.controls.selectedHeader.setValue('');

    fixture.componentInstance.confirm();

    expect(fixture.componentInstance.form.touched).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
