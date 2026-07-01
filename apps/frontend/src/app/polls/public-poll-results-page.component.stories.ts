import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import {
  ApiStoryState,
  apiStateOptions,
  setVotingStoryState,
  storybookBaseProviders,
  votingMswHandlers,
} from '../testing/storybook-voting-mocks';
import { PublicPollResultsPageComponent } from './public-poll-results-page.component';

@Component({
  selector: 'app-public-poll-results-story-host',
  imports: [PublicPollResultsPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-public-poll-results-page />
    }
  `,
})
class PublicPollResultsStoryHostComponent {
  readonly estado = input<ApiStoryState>('carregado');
  readonly respostasAoVivo = input(true);
  readonly sigilo = input<'public' | 'partiallySecret' | 'secret' | 'anonymous'>('public');
  readonly seed = input(42);
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      setVotingStoryState({
        pollDetailState: this.estado(),
        pollStatus: 'published',
        resultsLive: this.respostasAoVivo(),
        resultsPublic: true,
        votingStyle: this.sigilo(),
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

const meta: Meta<PublicPollResultsStoryHostComponent> = {
  title: 'Frontend/Polls/PublicPollResultsPageComponent',
  component: PublicPollResultsStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'poll-results-story' }),
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
    estado: 'carregado',
    respostasAoVivo: true,
    sigilo: 'public',
    seed: 42,
  },
  argTypes: {
    estado: {
      control: 'select',
      options: apiStateOptions,
    },
    respostasAoVivo: {
      control: 'boolean',
    },
    sigilo: {
      control: 'select',
      options: ['public', 'partiallySecret', 'secret', 'anonymous'],
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

type Story = StoryObj<PublicPollResultsStoryHostComponent>;

export const PublicoAoVivo: Story = {};

export const Sigiloso: Story = {
  args: {
    sigilo: 'secret',
  },
};

export const Erro: Story = {
  args: {
    estado: 'erro',
  },
};
