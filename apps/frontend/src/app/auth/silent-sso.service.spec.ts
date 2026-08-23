import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SilentSsoService } from './silent-sso.service';

describe('SilentSsoService', () => {
  let service: SilentSsoService;

  beforeEach(() => {
    document.head.innerHTML = '<base href="/">';
    document.body.innerHTML = '';
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    service = TestBed.inject(SilentSsoService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('checks the existing Keycloak session in a hidden iframe and reports authentication', async () => {
    const result = service.check();
    const iframe = requireIframe();
    const authorizationUrl = new URL(iframe.src);

    expect(iframe.hidden).toBe(true);
    expect(authorizationUrl.pathname).toBe('/api/auth/login/redirect');
    expect(authorizationUrl.searchParams.get('prompt')).toBe('none');
    expect(authorizationUrl.searchParams.get('returnTo')).toBe('/silent-check-sso.html');

    dispatchCompletionMessage(iframe, 'http://localhost:3000/silent-check-sso.html');

    await expect(result).resolves.toBe('authenticated');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('treats Keycloak login_required as an ordinary unauthenticated result', async () => {
    const result = service.check();
    const iframe = requireIframe();

    dispatchCompletionMessage(iframe, 'http://localhost:3000/silent-check-sso.html?sso=none');

    await expect(result).resolves.toBe('unauthenticated');
  });

  it('ignores messages that do not come from the silent SSO iframe', async () => {
    vi.useFakeTimers();
    const result = service.check();
    const iframe = requireIframe();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'cacic-silent-sso-complete',
          href: 'http://localhost:3000/silent-check-sso.html',
        },
        origin: window.location.origin,
        source: window,
      }),
    );
    const rejection = expect(result).rejects.toThrow('Silent SSO check timed out.');
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(iframe.isConnected).toBe(false);
  });

  it('rejects unexpected completion paths so the caller can use the redirect fallback', async () => {
    const result = service.check();
    const iframe = requireIframe();

    dispatchCompletionMessage(iframe, 'http://localhost:3000/not-the-sso-callback.html');

    await expect(result).rejects.toThrow('Silent SSO returned an unexpected completion URL.');
  });

  function requireIframe(): HTMLIFrameElement {
    const iframe = document.querySelector('iframe');
    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    return iframe as HTMLIFrameElement;
  }

  function dispatchCompletionMessage(iframe: HTMLIFrameElement, href: string): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'cacic-silent-sso-complete',
          href,
        },
        origin: window.location.origin,
        source: iframe.contentWindow,
      }),
    );
  }
});
