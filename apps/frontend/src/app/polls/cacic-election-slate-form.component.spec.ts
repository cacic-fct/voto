import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormGroup } from '@angular/forms';
import { SubmitCacicElectionSlateRequest } from '@org/voting-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacicElectionSlateFormComponent } from './cacic-election-slate-form.component';

describe('CacicElectionSlateFormComponent', () => {
  let fixture: ComponentFixture<CacicElectionSlateFormComponent>;
  let component: CacicElectionSlateFormComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CacicElectionSlateFormComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(CacicElectionSlateFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function internals() {
    return component as unknown as {
      form: FormGroup;
      formError: () => string | null;
      members: FormArray<FormGroup>;
      addMember(role?: SubmitCacicElectionSlateRequest['members'][number]['role']): void;
      submit(): void;
    };
  }

  function fillRequiredMembers(): void {
    const form = internals().form;
    form.patchValue({
      name: 'Chapa Aurora',
    });

    const roles: SubmitCacicElectionSlateRequest['members'][number]['role'][] = [
      'president',
      'vicePresident',
      'financialDirector',
      'communicationDirector',
      'eventsDirector',
      'publicRelationsDirector',
    ];
    internals().members.controls.forEach((member, index) => {
      member.patchValue({
        fullName: `Integrante ${index + 1}`,
        enrollmentNumber: `26${String(index + 1).padStart(6, '0')}`,
        role: roles[index],
        customRole: '',
        isRepresentative: index === 0,
        identifierType: 'email',
        identifierValue: `integrante-${index + 1}@example.com`,
      });
    });
  }

  it('blocks public submission until mandatory agreements are checked', () => {
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    fillRequiredMembers();

    internals().submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(internals().formError()).toBe('Confirme os compromissos obrigatórios para enviar a chapa.');

    internals().form.patchValue({
      noOnlineAccountsAgreement: true,
      electionDocumentationAgreement: true,
    });
    internals().submit();

    expect(submitted).toHaveBeenCalledWith({
      name: 'Chapa Aurora',
      members: expect.arrayContaining([
        expect.objectContaining({
          fullName: 'Integrante 1',
          enrollmentNumber: '26000001',
          role: 'president',
          isRepresentative: true,
          identifierType: 'email',
          identifierValue: 'integrante-1@example.com',
        }),
      ]),
    });
  });

  it('requires a custom role for members marked as other', () => {
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    fillRequiredMembers();
    internals().form.patchValue({
      noOnlineAccountsAgreement: true,
      electionDocumentationAgreement: true,
    });
    internals().addMember('other');
    internals().members.at(6).patchValue({
      fullName: 'Integrante adicional',
      enrollmentNumber: '26000007',
      role: 'other',
      customRole: '',
      isRepresentative: false,
      identifierType: 'phone',
      identifierValue: '18999999999',
    });

    internals().submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(internals().formError()).toBe('Informe o cargo adicional dos integrantes marcados como Outro.');
  });
});
