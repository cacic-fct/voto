import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { PollVoterEligibilitySource, PollVotingStyle } from '@org/voting-contracts';
import {
  ApiStoryState,
  SubmitStoryState,
  apiStateOptions,
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
