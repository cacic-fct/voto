import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AdminCacicElectionSlate,
  CACIC_ELECTION_SLATE_MEMBER_IDENTIFIER_TYPES,
  CACIC_ELECTION_SLATE_MEMBER_ROLES,
  CacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole,
  SubmitCacicElectionSlateRequest,
  UpdateCacicElectionSlateRequest,
} from '@org/voting-contracts';

type SlateMemberForm = FormGroup<{
  fullName: FormControl<string>;
  enrollmentNumber: FormControl<string>;
  role: FormControl<CacicElectionSlateMemberRole>;
  customRole: FormControl<string>;
  isRepresentative: FormControl<boolean>;
  identifierType: FormControl<CacicElectionSlateMemberIdentifierType>;
  identifierValue: FormControl<string>;
}>;

type SlateForm = FormGroup<{
  name: FormControl<string>;
  members: FormArray<SlateMemberForm>;
  noOnlineAccountsAgreement: FormControl<boolean>;
  electionDocumentationAgreement: FormControl<boolean>;
}>;

const requiredRoles = [
  'president',
  'vicePresident',
  'financialDirector',
  'communicationDirector',
  'eventsDirector',
  'publicRelationsDirector',
] as const satisfies readonly CacicElectionSlateMemberRole[];

@Component({
  selector: 'app-cacic-election-slate-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  template: `
    <form class="slate-form" [formGroup]="form" (ngSubmit)="submit()">
      <mat-form-field appearance="outline">
        <mat-label>Nome da chapa</mat-label>
        <input matInput formControlName="name" maxlength="240" />
      </mat-form-field>

      <div class="member-toolbar">
        <div>
          <h3>Integrantes</h3>
          <p>{{ members.controls.length }} membros cadastrados</p>
        </div>
        <button mat-stroked-button type="button" (click)="addMember()">
          <mat-icon>person_add</mat-icon>
          Adicionar integrante
        </button>
      </div>

      <div class="member-list" formArrayName="members">
        @for (member of members.controls; track member; let index = $index) {
          <mat-card appearance="outlined" class="member-card" [formGroupName]="index">
            <mat-card-header>
              <mat-icon mat-card-avatar>badge</mat-icon>
              <mat-card-title>Integrante {{ index + 1 }}</mat-card-title>
              <button
                matIconButton
                type="button"
                matTooltip="Remover integrante"
                aria-label="Remover integrante"
                [disabled]="members.controls.length <= 6"
                (click)="removeMember(index)">
                <mat-icon>delete</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <div class="member-grid">
                <mat-form-field appearance="outline">
                  <mat-label>Nome completo</mat-label>
                  <input matInput formControlName="fullName" maxlength="240" />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Matrícula</mat-label>
                  <input matInput formControlName="enrollmentNumber" maxlength="64" />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Cargo</mat-label>
                  <mat-select formControlName="role">
                    @for (role of roleOptions; track role) {
                      <mat-option [value]="role">{{ roleLabel(role) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                @if (member.controls.role.value === 'other') {
                  <mat-form-field appearance="outline">
                    <mat-label>Cargo adicional</mat-label>
                    <input matInput formControlName="customRole" maxlength="120" />
                  </mat-form-field>
                }

                <mat-form-field appearance="outline">
                  <mat-label>Documento de identificação</mat-label>
                  <mat-select formControlName="identifierType">
                    @for (type of identifierTypeOptions; track type) {
                      <mat-option [value]="type">{{ identifierTypeLabel(type) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Identificador</mat-label>
                  <input matInput formControlName="identifierValue" maxlength="255" />
                </mat-form-field>

                <mat-checkbox
                  class="representative-check"
                  [checked]="member.controls.isRepresentative.value"
                  (change)="setRepresentative(index, $event.checked)">
                  Representante da chapa
                </mat-checkbox>
              </div>
            </mat-card-content>
          </mat-card>
        }
      </div>

      <div class="member-toolbar bottom-toolbar">
        <div>
          <h3>Integrantes</h3>
          <p>{{ members.controls.length }} membros cadastrados</p>
        </div>
        <button mat-stroked-button type="button" (click)="addMember()">
          <mat-icon>person_add</mat-icon>
          Adicionar integrante
        </button>
      </div>

      @if (showAgreements()) {
        <mat-divider></mat-divider>
        <div class="agreement-list">
          <mat-checkbox formControlName="noOnlineAccountsAgreement">
            Concordo em não criar contas em serviços on-line para a chapa, incluindo Instagram e Google (Drive e Gmail).
          </mat-checkbox>
          <mat-checkbox formControlName="electionDocumentationAgreement">
            O representante da chapa leu o estatuto do CACiC, está ciente das disposições contidas nele e concorda com as diretrizes da documentação de eleições no site do CACiC.
          </mat-checkbox>
        </div>
      }

      @if (formError()) {
        <p class="form-error" role="alert">{{ formError() }}</p>
      }

      <div class="form-actions">
        <button mat-flat-button type="submit" [disabled]="busy()">
          <mat-icon>send</mat-icon>
          {{ submitLabel() }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .slate-form {
      display: grid;
      gap: 1rem;
    }

    .member-toolbar,
    .form-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .member-toolbar h3,
    .member-toolbar p {
      margin: 0;
    }

    .member-toolbar p {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .bottom-toolbar {
      border-block-start: 1px solid var(--mat-sys-outline-variant);
      padding-block-start: 0.75rem;
    }

    .member-list {
      display: grid;
      gap: 0.75rem;
    }

    .member-card {
      border-radius: 8px;
    }

    .member-card mat-card-header {
      align-items: center;
      justify-content: space-between;
    }

    .member-card mat-card-title {
      font: var(--mat-sys-title-medium);
    }

    mat-form-field {
      width: 100%;
    }

    .member-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 0.75rem;
      align-items: start;
    }

    .representative-check {
      min-height: 3.5rem;
      display: flex;
      align-items: center;
    }

    .agreement-list {
      display: grid;
      gap: 0.5rem;
    }

    .form-error {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }

    @media (max-width: 720px) {
      .member-toolbar,
      .form-actions {
        align-items: stretch;
        flex-direction: column;
      }

      .member-toolbar > button,
      .form-actions > button {
        width: 100%;
      }
    }
  `,
})
export class CacicElectionSlateFormComponent {
  private readonly fb = inject(NonNullableFormBuilder);

  readonly slate = input<AdminCacicElectionSlate | null>(null);
  readonly busy = input(false);
  readonly submitLabel = input('Enviar chapa');
  readonly showAgreements = input(true);
  readonly submitted = output<SubmitCacicElectionSlateRequest | UpdateCacicElectionSlateRequest>();

  protected readonly roleOptions = CACIC_ELECTION_SLATE_MEMBER_ROLES;
  protected readonly identifierTypeOptions = CACIC_ELECTION_SLATE_MEMBER_IDENTIFIER_TYPES;
  protected readonly formError = signal<string | null>(null);
  protected readonly form: SlateForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(240)]],
    members: this.fb.array<SlateMemberForm>([]),
    noOnlineAccountsAgreement: [false],
    electionDocumentationAgreement: [false],
  });

  constructor() {
    effect(() => {
      this.populateForm(this.slate());
    });
  }

  protected get members(): FormArray<SlateMemberForm> {
    return this.form.controls.members;
  }

  protected addMember(role: CacicElectionSlateMemberRole = 'other'): void {
    this.members.push(this.createMemberForm({ role }));
  }

  protected removeMember(index: number): void {
    if (this.members.controls.length <= 6) {
      return;
    }

    this.members.removeAt(index);
  }

  protected setRepresentative(index: number, checked: boolean): void {
    this.members.controls.forEach((member, memberIndex) => {
      member.controls.isRepresentative.setValue(checked && memberIndex === index);
    });
  }

  protected submit(): void {
    this.formError.set(null);
    this.form.markAllAsTouched();

    const validationError = this.validateForm();
    if (validationError) {
      this.formError.set(validationError);
      return;
    }

    this.submitted.emit({
      name: this.form.controls.name.value.trim(),
      members: this.members.controls.map((member) => ({
        fullName: member.controls.fullName.value.trim(),
        enrollmentNumber: member.controls.enrollmentNumber.value.trim(),
        role: member.controls.role.value,
        ...(member.controls.role.value === 'other'
          ? { customRole: member.controls.customRole.value.trim() }
          : {}),
        isRepresentative: member.controls.isRepresentative.value,
        identifierType: member.controls.identifierType.value,
        identifierValue: member.controls.identifierValue.value.trim(),
      })),
    });
  }

  protected roleLabel(role: CacicElectionSlateMemberRole): string {
    switch (role) {
      case 'president':
        return 'Presidente';
      case 'vicePresident':
        return 'Vice-Presidente';
      case 'financialDirector':
        return 'Diretor Financeiro';
      case 'communicationDirector':
        return 'Diretor de Comunicação';
      case 'eventsDirector':
        return 'Diretor de Eventos';
      case 'publicRelationsDirector':
        return 'Diretor de Relações Públicas';
      case 'other':
        return 'Outro';
    }
  }

  protected identifierTypeLabel(type: CacicElectionSlateMemberIdentifierType): string {
    switch (type) {
      case 'cpf':
        return 'CPF';
      case 'phone':
        return 'Telefone';
      case 'email':
        return 'E-mail';
    }
  }

  private populateForm(slate: AdminCacicElectionSlate | null): void {
    this.form.controls.name.setValue(slate?.name ?? '');
    this.form.controls.noOnlineAccountsAgreement.setValue(false);
    this.form.controls.electionDocumentationAgreement.setValue(false);
    this.members.clear();

    const members = slate?.members.length
      ? slate.members
      : requiredRoles.map((role, index) => ({
          fullName: '',
          enrollmentNumber: '',
          role,
          customRole: '',
          isRepresentative: index === 0,
          identifierType: 'email' as const,
          identifierValue: '',
        }));

    for (const member of members) {
      this.members.push(this.createMemberForm(member));
    }
  }

  private createMemberForm(member: Partial<SubmitCacicElectionSlateRequest['members'][number]>): SlateMemberForm {
    return this.fb.group({
      fullName: [member.fullName ?? '', [Validators.required, Validators.maxLength(240)]],
      enrollmentNumber: [member.enrollmentNumber ?? '', [Validators.required, Validators.maxLength(64)]],
      role: member.role ?? 'other',
      customRole: [member.customRole ?? '', [Validators.maxLength(120)]],
      isRepresentative: member.isRepresentative ?? false,
      identifierType: member.identifierType ?? 'email',
      identifierValue: [member.identifierValue ?? '', [Validators.required, Validators.maxLength(255)]],
    });
  }

  private validateForm(): string | null {
    if (!this.form.controls.name.value.trim()) {
      return 'Informe o nome da chapa.';
    }

    if (this.members.controls.length < 6) {
      return 'A chapa deve conter no mínimo 6 membros.';
    }

    if (this.members.controls.some((member) => !member.controls.fullName.value.trim())) {
      return 'Informe o nome completo de todos os integrantes.';
    }

    if (this.members.controls.some((member) => !member.controls.enrollmentNumber.value.trim())) {
      return 'Informe a matrícula de todos os integrantes.';
    }

    if (this.members.controls.some((member) => !member.controls.identifierValue.value.trim())) {
      return 'Informe CPF, telefone ou e-mail para todos os integrantes.';
    }

    const roleCounts = new Map<CacicElectionSlateMemberRole, number>();
    for (const member of this.members.controls) {
      const role = member.controls.role.value;
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      if (role === 'other' && !member.controls.customRole.value.trim()) {
        return 'Informe o cargo adicional dos integrantes marcados como Outro.';
      }
    }

    if (requiredRoles.some((role) => !roleCounts.has(role))) {
      return 'A chapa deve contemplar todos os cargos obrigatórios.';
    }

    if ((roleCounts.get('president') ?? 0) !== 1 || (roleCounts.get('vicePresident') ?? 0) !== 1) {
      return 'A chapa deve ter exatamente um Presidente e um Vice-Presidente.';
    }

    if (this.members.controls.filter((member) => member.controls.isRepresentative.value).length !== 1) {
      return 'Indique exatamente um representante da chapa.';
    }

    if (
      this.showAgreements() &&
      (!this.form.controls.noOnlineAccountsAgreement.value ||
        !this.form.controls.electionDocumentationAgreement.value)
    ) {
      return 'Confirme os compromissos obrigatórios para enviar a chapa.';
    }

    return null;
  }
}
