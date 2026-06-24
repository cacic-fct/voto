import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { App } from './app';
import { storybookBaseProviders } from './testing/storybook-voting-mocks';

type AppStoryArgs = {
  conteudo: string;
  mostrarResumo: boolean;
  titulo: string;
};

const appStoryState = signal<AppStoryArgs>({
  conteudo: 'Conteúdo renderizado pela rota inicial no Storybook.',
  mostrarResumo: true,
  titulo: 'CACiC Voto',
});

@Component({
  selector: 'app-storybook-home-route',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="storybook-home">
      <h1>{{ state().titulo }}</h1>
      <p>{{ state().conteudo }}</p>

      @if (state().mostrarResumo) {
        <dl>
          <dt>Ambiente</dt>
          <dd>Storybook</dd>
          <dt>Rota</dt>
          <dd>/</dd>
        </dl>
      }
    </section>
  `,
  styles: [
    `
      .storybook-home {
        display: grid;
        gap: 16px;
        max-width: 720px;
        padding: 32px;
      }

      h1,
      p,
      dl {
        margin: 0;
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 8px 16px;
      }

      dt {
        font-weight: 700;
      }
    `,
  ],
})
class StorybookHomeRouteComponent {
  protected readonly state = appStoryState;
}

const meta: Meta<AppStoryArgs> = {
  title: 'Frontend/App/App',
  component: App,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([
          {
            path: '',
            component: StorybookHomeRouteComponent,
          },
        ]),
      ],
    }),
  ],
  args: appStoryState(),
  argTypes: {
    conteudo: {
      control: 'text',
    },
    mostrarResumo: {
      control: 'boolean',
    },
    titulo: {
      control: 'text',
    },
  },
  render: (args) => {
    appStoryState.set(args);
    return {
      props: args,
    };
  },
};

export default meta;

type Story = StoryObj<AppStoryArgs>;

export const Padrao: Story = {};
