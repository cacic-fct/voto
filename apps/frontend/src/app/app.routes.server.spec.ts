import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { serverRoutes } from './app.routes.server';

describe('serverRoutes', () => {
  it('prerenders login and keeps authenticated routes client-rendered', () => {
    expect(serverRoutes).toEqual([
      { path: 'login', renderMode: RenderMode.Prerender },
      { path: '', renderMode: RenderMode.Client },
      { path: 'polls', renderMode: RenderMode.Client },
      { path: 'polls/direct/:directLinkToken/results', renderMode: RenderMode.Client },
      { path: 'polls/direct/:directLinkToken', renderMode: RenderMode.Client },
      { path: 'polls/:id/results', renderMode: RenderMode.Client },
      { path: 'polls/:id', renderMode: RenderMode.Client },
      { path: 'admin', renderMode: RenderMode.Client },
      { path: '**', renderMode: RenderMode.Client },
    ]);
  });
});
