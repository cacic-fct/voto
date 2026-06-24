import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import {
  ApiStoryState,
  apiStateOptions,
  setVotingStoryState,
  storybookBaseProviders,
  votingMswHandlers,
} from '../testing/storybook-voting-mocks';
import { PublicPollsPageComponent } from './public-polls-page.component';

@Component({
  selector: 'app-public-polls-story-host',
  imports: [PublicPollsPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-public-polls-page />
    }
  `,
})
class PublicPollsStoryHostComponent {
  readonly estado = input<ApiStoryState>('carregado');
  readonly quantidade = input(4);
  readonly seed = input(42);
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      setVotingStoryState({
        publicPollCount: this.quantidade(),
        publicPollsState: this.estado(),
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

const meta: Meta<PublicPollsStoryHostComponent> = {
  title: 'Frontend/Polls/PublicPollsPageComponent',
  component: PublicPollsStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([
          {
            path: 'polls/:id',
            component: PublicPollsStoryHostComponent,
          },
        ]),
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
    quantidade: 4,
    seed: 42,
  },
  argTypes: {
    estado: {
      control: 'select',
      options: apiStateOptions,
    },
    quantidade: {
      control: {
        type: 'number',
        min: 0,
        max: 8,
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

type Story = StoryObj<PublicPollsStoryHostComponent>;

export const ListaPublicada: Story = {};

export const Vazio: Story = {
  args: {
    estado: 'vazio',
    quantidade: 0,
  },
};

export const Erro: Story = {
  args: {
    estado: 'erro',
  },
};
