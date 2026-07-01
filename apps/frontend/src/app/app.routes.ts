import { Route } from '@angular/router';
import { adminGuard } from './auth/admin.guard';
import { authGuard, redirectAuthenticatedGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [redirectAuthenticatedGuard],
    loadComponent: () => import('./auth/login-page.component').then((component) => component.LoginPageComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/app-shell.component').then((component) => component.AppShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'polls',
      },
      {
        path: 'polls',
        loadComponent: () =>
          import('./polls/public-polls-page.component').then((component) => component.PublicPollsPageComponent),
      },
      {
        path: 'polls/direct/:directLinkToken/results',
        loadComponent: () =>
          import('./polls/public-poll-results-page.component').then(
            (component) => component.PublicPollResultsPageComponent,
          ),
      },
      {
        path: 'polls/direct/:directLinkToken',
        loadComponent: () =>
          import('./polls/poll-vote-page.component').then((component) => component.PollVotePageComponent),
      },
      {
        path: 'polls/:id/results',
        loadComponent: () =>
          import('./polls/public-poll-results-page.component').then(
            (component) => component.PublicPollResultsPageComponent,
          ),
      },
      {
        path: 'polls/:id',
        loadComponent: () =>
          import('./polls/poll-vote-page.component').then((component) => component.PollVotePageComponent),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./admin/admin-poll-builder-page.component').then(
            (component) => component.AdminPollBuilderPageComponent,
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
