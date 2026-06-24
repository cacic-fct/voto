import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fakerPT_BR as faker } from '@faker-js/faker';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { storybookBaseProviders } from '../testing/storybook-voting-mocks';
import {
  EligibilityCsvColumnDialogComponent,
  EligibilityCsvColumnDialogData,
} from './eligibility-csv-column-dialog.component';

type EligibilityCsvColumnDialogStoryArgs = {
  arquivo: string;
  cabecalhos: string;
  linhas: number;
  seed: number;
};

const dialogStoryState = signal<EligibilityCsvColumnDialogStoryArgs>({
  arquivo: 'matriculas.csv',
  cabecalhos: 'matricula,nome,email',
  linhas: 6,
  seed: 42,
});

@Component({
  selector: 'app-eligibility-csv-column-dialog-story-host',
  imports: [EligibilityCsvColumnDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-eligibility-csv-column-dialog />
    }
  `,
})
class EligibilityCsvColumnDialogStoryHostComponent {
  readonly arquivo = input('matriculas.csv');
  readonly cabecalhos = input('matricula,nome,email');
  readonly linhas = input(6);
  readonly seed = input(42);
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      dialogStoryState.set({
        arquivo: this.arquivo(),
        cabecalhos: this.cabecalhos(),
        linhas: this.linhas(),
        seed: this.seed(),
      });
      this.remount();
    });
  }

  private remount(): void {
    this.visible.set(false);
    queueMicrotask(() => this.visible.set(true));
  }
}

function createDialogData(): EligibilityCsvColumnDialogData {
  const state = dialogStoryState();
  const headers = state.cabecalhos
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean);
  const safeHeaders = headers.length > 0 ? headers : ['matricula'];

  faker.seed(state.seed);

  return {
    fileName: state.arquivo,
    headers: safeHeaders,
    previewRows: Array.from({ length: Math.max(0, state.linhas) }, (_, index) =>
      safeHeaders.reduce<Record<string, string>>((row, header) => {
        row[header] = valueForHeader(header, index);
        return row;
      }, {}),
    ),
  };
}

function valueForHeader(header: string, index: number): string {
  const normalizedHeader = header.toLowerCase();

  if (normalizedHeader.includes('matr')) {
    return `${20260000 + index + 1}`;
  }

  if (normalizedHeader.includes('mail') || normalizedHeader.includes('email')) {
    return faker.internet.email().toLowerCase();
  }

  if (normalizedHeader.includes('nome')) {
    return faker.person.fullName();
  }

  return faker.lorem.words({ min: 1, max: 3 });
}

const dialogRefMock = {
  close: () => undefined,
} as unknown as MatDialogRef<EligibilityCsvColumnDialogComponent, string | null>;

const meta: Meta<EligibilityCsvColumnDialogStoryHostComponent> = {
  title: 'Frontend/Admin/EligibilityCsvColumnDialogComponent',
  component: EligibilityCsvColumnDialogStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        {
          provide: MAT_DIALOG_DATA,
          useFactory: createDialogData,
        },
        {
          provide: MatDialogRef,
          useValue: dialogRefMock,
        },
      ],
    }),
  ],
  args: dialogStoryState(),
  argTypes: {
    arquivo: {
      control: 'text',
    },
    cabecalhos: {
      control: 'text',
    },
    linhas: {
      control: {
        type: 'number',
        min: 0,
        max: 12,
        step: 1,
      },
    },
    seed: {
      control: {
        type: 'number',
        min: 1,
        step: 1,
      },
    },
  },
};

export default meta;

type Story = StoryObj<EligibilityCsvColumnDialogStoryHostComponent>;

export const CsvComMatricula: Story = {};

export const CabecalhosAlternativos: Story = {
  args: {
    cabecalhos: 'Nome completo,E-mail institucional,RA',
    linhas: 4,
  },
};
