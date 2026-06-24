import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { createStoryUser, storybookBaseProviders } from '../testing/storybook-voting-mocks';
import { AppShellComponent } from './app-shell.component';

type ShellStoryArgs = {
  email: string;
  perfil: 'eleitor' | 'administrador';
  rotaAtiva: '/polls' | '/admin';
};

const shellStoryState = signal<ShellStoryArgs>({
  email: 'eleitor@cacic.dev',
  perfil: 'eleitor',
  rotaAtiva: '/polls',
});

@Component({
  selector: 'app-shell-story-host',
  imports: [AppShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-shell />',
})
class ShellStoryHostComponent {
  readonly email = input('eleitor@cacic.dev');
  readonly perfil = input<ShellStoryArgs['perfil']>('eleitor');
  readonly rotaAtiva = input<ShellStoryArgs['rotaAtiva']>('/polls');
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const state: ShellStoryArgs = {
        email: this.email(),
        perfil: this.perfil(),
        rotaAtiva: this.rotaAtiva(),
      };

      shellStoryState.set(state);
      queueMicrotask(() => void this.router.navigateByUrl(state.rotaAtiva));
    });
  }
}

@Component({
  selector: 'app-shell-placeholder-route',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<section class="placeholder-route">Conteúdo da rota selecionada.</section>',
  styles: [
    `
      .placeholder-route {
        padding: 24px;
      }
    `,
  ],
})
class ShellPlaceholderRouteComponent {}

function createAuthServiceMock(): AuthService {
  return {
    logout: async () => undefined,
    user: computed(() => createStoryUser(shellStoryState().email, shellStoryState().perfil === 'administrador')),
  } as unknown as AuthService;
}

function createPermissionsServiceMock(): PermissionsService {
  return {
    evaluateAdminPermissions: async () => undefined,
    isAdmin: computed(() => shellStoryState().perfil === 'administrador'),
  } as unknown as PermissionsService;
}

const meta: Meta<ShellStoryHostComponent> = {
  title: 'Frontend/Shell/AppShellComponent',
  component: ShellStoryHostComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([
          {
            path: 'polls',
            component: ShellPlaceholderRouteComponent,
          },
          {
            path: 'admin',
            component: ShellPlaceholderRouteComponent,
          },
        ]),
        {
          provide: AuthService,
          useFactory: createAuthServiceMock,
        },
        {
          provide: PermissionsService,
          useFactory: createPermissionsServiceMock,
        },
      ],
    }),
  ],
  args: shellStoryState(),
  argTypes: {
    email: {
      control: 'text',
    },
    perfil: {
      control: 'select',
      options: ['eleitor', 'administrador'],
    },
    rotaAtiva: {
      control: 'select',
      options: ['/polls', '/admin'],
    },
  },
};

export default meta;

type Story = StoryObj<ShellStoryHostComponent>;

export const Eleitor: Story = {};

export const Administrador: Story = {
  args: {
    email: 'admin@cacic.dev',
    perfil: 'administrador',
    rotaAtiva: '/admin',
  },
};
