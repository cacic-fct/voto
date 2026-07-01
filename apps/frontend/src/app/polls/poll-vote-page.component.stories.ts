import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { CacicElectionPhase, PollMode, PollStatus, PollVoterEligibilitySource, PollVotingStyle } from '@org/voting-contracts';
import {
  ApiStoryState,
  MySlateStoryState,
  SubmitStoryState,
  apiStateOptions,
  cacicElectionPhaseControlLabels,
  cacicElectionPhaseControlOptions,
  mySlateStateOptions,
  pollModeControlLabels,
  pollModeControlOptions,
  pollStatusControlLabels,
  pollStatusControlOptions,
  setVotingStoryState,
  storybookBaseProviders,
  submitStateOptions,
  voterEligibilityControlLabels,
  voterEligibilityControlOptions,
  votingMswHandlers,
  votingStyleControlLabels,
  votingStyleControlOptions,
} from '../testing/storybook-voting-mocks';
import { PollVotePageComponent } from './poll-vote-page.component';

@Component({
  selector: 'app-poll-vote-story-host',
  imports: [PollVotePageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-poll-vote-page />
    }
  `,
})
class PollVoteStoryHostComponent {
  readonly descricao = input('Escolha as opções que representam melhor a decisão coletiva.');
  readonly estado = input<ApiStoryState>('carregado');
  readonly estilo = input<PollVotingStyle>('secret');
  readonly eventoVinculado = input(true);
  readonly permitirEdicao = input(false);
  readonly permitirMultiplas = input(false);
  readonly habilitacao = input<PollVoterEligibilitySource>('authenticatedUsers');
  readonly itens = input(14);
  readonly modo = input<PollMode>('regular');
  readonly faseEleicao = input<CacicElectionPhase>('slateSubmission');
  readonly situacao = input<PollStatus>('published');
  readonly chapas = input(3);
  readonly minhaChapa = input<MySlateStoryState>('nenhuma');
  readonly seed = input(42);
  readonly titulo = input('Votação da assembleia geral');
  readonly envio = input<SubmitStoryState>('sucesso');
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      setVotingStoryState({
        includeLinkedEvent: this.eventoVinculado(),
        pollDescription: this.descricao(),
        pollDetailState: this.estado(),
        pollElementCount: this.itens(),
        pollMode: this.modo(),
        cacicElectionPhase: this.faseEleicao(),
        pollStatus: this.situacao(),
        slateCount: this.chapas(),
        mySlateState: this.minhaChapa(),
        pollTitle: this.titulo(),
        seed: this.seed(),
        submitState: this.envio(),
        voterEligibilitySource: this.habilitacao(),
        votingStyle: this.estilo(),
        allowResponseEditing: this.permitirEdicao(),
        allowMultipleResponses: this.permitirMultiplas(),
      });
      this.remount();
    });
  }

  private remount(): void {
    this.visible.set(false);
    queueMicrotask(() => this.visible.set(true));
  }
}

const meta: Meta<PollVoteStoryHostComponent> = {
  title: 'Frontend/Polls/PollVotePageComponent',
  component: PollVoteStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([
          {
            path: 'polls',
            component: PollVoteStoryHostComponent,
          },
        ]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({
                id: 'poll-story',
              }),
            },
          },
        },
      ],
    }),
  ],
  parameters: {
    msw: {
      handlers: votingMswHandlers,
    },
  },
  args: {
    descricao: 'Escolha as opções que representam melhor a decisão coletiva.',
    estado: 'carregado',
    estilo: 'secret',
    eventoVinculado: true,
    permitirEdicao: false,
    permitirMultiplas: false,
    habilitacao: 'authenticatedUsers',
    itens: 14,
    modo: 'regular',
    faseEleicao: 'slateSubmission',
    situacao: 'published',
    chapas: 3,
    minhaChapa: 'nenhuma',
    seed: 42,
    titulo: 'Votação da assembleia geral',
    envio: 'sucesso',
  },
  argTypes: {
    descricao: {
      control: 'text',
    },
    estado: {
      control: 'select',
      options: apiStateOptions,
    },
    estilo: {
      control: {
        type: 'select',
        labels: votingStyleControlLabels,
      },
      options: votingStyleControlOptions,
    },
    eventoVinculado: {
      control: 'boolean',
    },
    permitirEdicao: {
      control: 'boolean',
    },
    permitirMultiplas: {
      control: 'boolean',
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
    minhaChapa: {
      control: 'select',
      options: mySlateStateOptions,
    },
    seed: {
      control: {
        type: 'number',
        min: 1,
        step: 1,
      },
    },
    titulo: {
      control: 'text',
    },
    envio: {
      control: 'select',
      options: submitStateOptions,
    },
  },
};

export default meta;

type Story = StoryObj<PollVoteStoryHostComponent>;

export const FormularioCompleto: Story = {};

export const SemItens: Story = {
  args: {
    estado: 'vazio',
    itens: 0,
  },
};

export const EnvioDuplicado: Story = {
  args: {
    envio: 'duplicado',
  },
};

export const EleicoesSubmissaoChapas: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'slateSubmission',
    titulo: 'Eleições do CACiC - submissão de chapas',
    descricao: 'Cadastre a chapa para revisão da comissão eleitoral.',
    itens: 0,
    chapas: 2,
    minhaChapa: 'nenhuma',
  },
};

export const EleicoesChapaRejeitada: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'slateSubmission',
    titulo: 'Eleições do CACiC - correção de chapa',
    descricao: 'Ajuste a chapa rejeitada enquanto o prazo de submissão estiver aberto.',
    itens: 0,
    chapas: 2,
    minhaChapa: 'rejeitada',
  },
};

export const EleicoesVotacao: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'election',
    titulo: 'Eleições do CACiC',
    descricao: 'Escolha uma chapa aprovada ou registre voto em branco ou nulo.',
    habilitacao: 'enrollmentList',
    itens: 1,
    chapas: 3,
    situacao: 'published',
  },
};

export const EleicoesEncerradas: Story = {
  args: {
    modo: 'cacicElection',
    faseEleicao: 'election',
    titulo: 'Eleições do CACiC - resultado',
    descricao: 'Resultados liberados após o encerramento da votação.',
    habilitacao: 'enrollmentList',
    itens: 1,
    chapas: 3,
    situacao: 'closed',
  },
};
