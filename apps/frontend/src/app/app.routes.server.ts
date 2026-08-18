import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'login',
    renderMode: RenderMode.Prerender,
  },
  {
    path: '',
    renderMode: RenderMode.Client,
  },
  {
    path: 'polls',
    renderMode: RenderMode.Client,
  },
  {
    path: 'polls/direct/:directLinkToken/results',
    renderMode: RenderMode.Client,
  },
  {
    path: 'polls/direct/:directLinkToken',
    renderMode: RenderMode.Client,
  },
  {
    path: 'polls/:id/results',
    renderMode: RenderMode.Client,
  },
  {
    path: 'polls/:id',
    renderMode: RenderMode.Client,
  },
  {
    path: 'admin/polls/:id/kiosk/vote',
    renderMode: RenderMode.Client,
  },
  {
    path: 'admin/polls/:id/kiosk',
    renderMode: RenderMode.Client,
  },
  {
    path: 'admin',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
