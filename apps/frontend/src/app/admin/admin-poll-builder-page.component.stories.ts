import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { CacicElectionPhase, PollMode, PollStatus, PollVoterEligibilitySource, PollVotingStyle } from '@org/voting-contracts';
import {
  ApiStoryState,
  apiStateOptions,
  cacicElectionPhaseControlLabels,
  cacicElectionPhaseControlOptions,
  setVotingStoryState,
  storybookBaseProviders,
  pollModeControlLabels,
  pollModeControlOptions,
  pollStatusControlLabels,
  pollStatusControlOptions,
  voterEligibilityControlLabels,
  voterEligibilityControlOptions,
  votingMswHandlers,
  votingStyleControlLabels,
  votingStyleControlOptions,
} from '../testing/storybook-voting-mocks';
import { AdminPollBuilderPageComponent } from './admin-poll-builder-page.component';

@Component({
  selector: 'app-admin-poll-builder-story-host',
  imports: [AdminPollBuilderPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-admin-poll-builder-page />
    }
  `,
})
class AdminPollBuilderStoryHostComponent {
  readonly estadoEventos = input<ApiStoryState>('carregado');
  readonly estadoLista = input<ApiStoryState>('carregado');
  readonly eventos = input(3);
  readonly estilo = input<PollVotingStyle>('secret');
  readonly habilitacao = input<PollVoterEligibilitySource>('enrollmentList');
  readonly itens = input(14);
  readonly matriculas = input(6);
  readonly modo = input<PollMode>('regular');
  readonly faseEleicao = input<CacicElectionPhase>('slateSubmission');
  readonly permitirEdicao = input(false);
  readonly permitirMultiplas = input(false);
  readonly seed = input(42);
  readonly situacao = input<PollStatus>('published');
  readonly chapas = input(3);
  readonly votacoes = input(4);
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      setVotingStoryState({
        adminPollCount: this.votacoes(),
        adminPollsState: this.estadoLista(),
        eligibilityEnrollmentCount: this.matriculas(),
        linkableEventsState: this.estadoEventos(),
        linkedEventCount: this.eventos(),
        pollElementCount: this.itens(),
        pollMode: this.modo(),
        cacicElectionPhase: this.faseEleicao(),
        pollStatus: this.situacao(),
        slateCount: this.chapas(),
        votingStyle: this.estilo(),
        allowResponseEditing: this.permitirEdicao(),
        allowMultipleResponses: this.permitirMultiplas(),
        seed: this.seed(),
        voterEligibilitySource: this.habilitacao(),
      });
      this.remount();
    });
  }

  private remount(): void {
    this.visible.set(false);
    queueMicrotask(() => this.visible.set(true));
  }
}

const meta: Meta<AdminPollBuilderStoryHostComponent> = {
  title: 'Frontend/Admin/AdminPollBuilderPageComponent',
  component: AdminPollBuilderStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [...storybookBaseProviders, provideRouter([])],
    }),
  ],
  parameters: {
    msw: {
      handlers: votingMswHandlers,
    },
  },
  args: {
    estadoEventos: 'carregado',
    estadoLista: 'carregado',
    eventos: 3,
    estilo: 'secret',
    habilitacao: 'enrollmentList',
    itens: 14,
    matriculas: 6,
    modo: 'regular',
    faseEleicao: 'slateSubmission',
    permitirEdicao: false,
    permitirMultiplas: false,
    seed: 42,
    situacao: 'published',
    chapas: 3,
    votacoes: 4,
  },
  argTypes: {
    estadoEventos: {
      control: 'select',
      options: apiStateOptions,
    },
    estadoLista: {
      control: 'select',
      options: apiStateOptions,
    },
    eventos: {
      control: {
        type: 'number',
        min: 0,
        max: 8,
        step: 1,
      },
    },
    estilo: {
      control: {
        type: 'select',
        labels: votingStyleControlLabels,
      },
      options: votingStyleControlOptions,
    },
    habilitacao: {
      control: {
        type: 'select',
        labels: voterEligibilityControlLabels,
      },
      options: voterEligibilityControlOptions,
    },
    itens: {
      control: {
        type: 'number',
        min: 0,
        max: 14,
        step: 1,
      },
    },
    matriculas: {
      control: {
        type: 'number',
        min: 0,
        max: 12,
        step: 1,
      },
    },
    modo: {
      control: {
        type: 'select',
        labels: pollModeControlLabels,
      },
      options: pollModeControlOptions,
    },
    faseEleicao: {
      control: {
        type: 'select',
        labels: cacicElectionPhaseControlLabels,
      },
      options: cacicElectionPhaseControlOptions,
    },
    permitirEdicao: {
      control: 'boolean',
    },
    permitirMultiplas: {
      control: 'boolean',
    },
    seed: {
      control: {
        type: 'number',
        min: 1,
        step: 1,
      },
    },
    situacao: {
      control: {
        type: 'select',
        labels: pollStatusControlLabels,
      },
      options: pollStatusControlOptions,
    },
    chapas: {
      control: {
        type: 'number',
        min: 0,
        max: 8,
        step: 1,
      },
    },
    votacoes: {
      control: {
        type: 'number',
        min: 0,
        max: 8,
        step: 1,
      },
    },
  },
};

export default meta;

type Story = StoryObj<AdminPollBuilderStoryHostComponent>;

export const ComDados: Story = {};

export const SemVotacoes: Story = {
  args: {
    estadoLista: 'vazio',
    votacoes: 0,
  },
};

export const SemItens: Story = {
  args: {
    itens: 0,
    matriculas: 0,
  },
};

export const SomenteAutenticados: Story = {
  args: {
    habilitacao: 'authenticatedUsers',
    itens: 3,
  },
};

export const EleicoesSubmissaoChapas: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'slateSubmission',
    itens: 0,
    chapas: 4,
    habilitacao: 'authenticatedUsers',
  },
};

export const EleicoesVotacao: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'election',
    situacao: 'published',
    itens: 1,
    chapas: 3,
    matriculas: 8,
  },
};

export const EleicoesSemChapas: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'election',
    chapas: 0,
    matriculas: 0,
  },
};

export const ErroEventos: Story = {
  args: {
    estadoEventos: 'erro',
  },
};
