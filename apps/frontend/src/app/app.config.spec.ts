import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationInitStatus, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { DateAdapter } from '@angular/material/core';
import { ptBR } from 'date-fns/locale';
import { MatIconRegistry } from '@angular/material/icon';
import { describe, expect, it, vi } from 'vitest';
import { SilentSsoService } from './auth/silent-sso.service';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('registers locales, icon defaults, HTTP, router, hydration, and auth initializers', async () => {
    const setDefaultFontSetClass = vi.spyOn(MatIconRegistry.prototype, 'setDefaultFontSetClass');

    TestBed.configureTestingModule({
      providers: [...(appConfig.providers ?? []), provideHttpClientTesting()],
    });
    TestBed.overrideProvider(SilentSsoService, {
      useValue: { check: vi.fn().mockResolvedValue('none') },
    });

    const initStatus = TestBed.inject(ApplicationInitStatus);
    const http = TestBed.inject(HttpTestingController);
    const done = initStatus.donePromise;

    http.expectOne('/api/auth/me').flush(null);
    await done;

    expect(TestBed.inject(LOCALE_ID)).toBe('pt-BR');
    expect(TestBed.inject(MAT_DATE_LOCALE)).toBe(ptBR);
    expect(TestBed.inject(DateAdapter).format(new Date(2026, 5, 16), 'P')).toBe('16/06/2026');
    expect(setDefaultFontSetClass).toHaveBeenCalledWith('material-symbols-outlined');
    http.verify();
    setDefaultFontSetClass.mockRestore();
  });
});
