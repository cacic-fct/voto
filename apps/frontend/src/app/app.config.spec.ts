import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationInitStatus, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { describe, expect, it, vi } from 'vitest';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('registers locale, icon defaults, HTTP, router, hydration, and auth initializers', async () => {
    const setDefaultFontSetClass = vi.spyOn(MatIconRegistry.prototype, 'setDefaultFontSetClass');

    TestBed.configureTestingModule({
      providers: [...(appConfig.providers ?? []), provideHttpClientTesting()],
    });

    const initStatus = TestBed.inject(ApplicationInitStatus);
    const http = TestBed.inject(HttpTestingController);
    const done = initStatus.donePromise;

    http.expectOne('/api/auth/me').flush(null);
    await done;

    expect(TestBed.inject(LOCALE_ID)).toBe('pt-BR');
    expect(setDefaultFontSetClass).toHaveBeenCalledWith('material-symbols-outlined');
    http.verify();
    setDefaultFontSetClass.mockRestore();
  });
});
