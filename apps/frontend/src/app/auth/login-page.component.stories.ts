import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { AuthService } from './auth.service';
import { LoginPageComponent } from './login-page.component';
import { createStoryUser, storybookBaseProviders } from '../testing/storybook-voting-mocks';

type LoginStoryArgs = {
  autenticado: boolean;
  email: string;
};

const loginStoryState = signal<LoginStoryArgs>({
  autenticado: false,
  email: 'eleitor@cacic.dev',
});

function createAuthServiceMock(): AuthService {
  return {
    isAuthenticated: computed(() => loginStoryState().autenticado),
    login: async () => undefined,
    user: computed(() =>
      loginStoryState().autenticado ? createStoryUser(loginStoryState().email, false) : null,
    ),
  } as unknown as AuthService;
}

const meta: Meta<LoginStoryArgs> = {
  title: 'Frontend/Auth/LoginPageComponent',
  component: LoginPageComponent,
  decorators: [
    applicationConfig({
      providers: [
        ...storybookBaseProviders,
        provideRouter([]),
        {
          provide: AuthService,
          useFactory: createAuthServiceMock,
        },
      ],
    }),
  ],
  args: loginStoryState(),
  argTypes: {
    autenticado: {
      control: 'boolean',
    },
    email: {
      control: 'text',
    },
  },
  render: (args) => {
    loginStoryState.set(args);
    return {
      props: args,
    };
  },
};

export default meta;

type Story = StoryObj<LoginStoryArgs>;

export const Desconectado: Story = {};

export const JaAutenticado: Story = {
  args: {
    autenticado: true,
    email: 'admin@cacic.dev',
  },
};
