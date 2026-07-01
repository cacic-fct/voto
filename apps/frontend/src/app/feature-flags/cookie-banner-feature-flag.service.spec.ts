import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UnleashClient } from 'unleash-proxy-client';
import { CookieBannerFeatureFlagService } from './cookie-banner-feature-flag.service';

vi.mock('unleash-proxy-client', () => ({
  UnleashClient: vi.fn().mockImplementation(() => ({
    isEnabled: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('CookieBannerFeatureFlagService', () => {
  type CookieBannerFeatureFlagServiceInternals = {
    readDevelopmentStorageValue(): boolean | null;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not initialize Unleash during server-side rendering', async () => {
    const service = createService('server');

    await service.initialize();

    expect(service.enabled()).toBe(true);
    expect(UnleashClient).not.toHaveBeenCalled();
  });

  it('creates and uses a development storage override when running in dev mode', async () => {
    const service = createService('browser');

    await service.initialize();

    expect(localStorage.getItem('cacic.cookieBanner.enabled')).toBe('true');
    expect(service.enabled()).toBe(true);
    expect(UnleashClient).not.toHaveBeenCalled();
  });

  it('honors disabled development storage overrides', async () => {
    localStorage.setItem('cacic.cookieBanner.enabled', 'false');
    const service = createService('browser');

    await service.initialize();

    expect(service.enabled()).toBe(false);
    expect(UnleashClient).not.toHaveBeenCalled();
  });

  it('keeps the banner enabled when development storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = createService('browser');

    await service.initialize();

    expect(service.enabled()).toBe(true);
  });

  it('turns noisy Unleash fetch failures into not-modified responses', async () => {
    const service = createService('browser');
    const fetchWithoutConsoleNoise = (service as unknown as { fetchWithoutConsoleNoise: typeof fetch })
      .fetchWithoutConsoleNoise;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    await expect(fetchWithoutConsoleNoise('/api/frontend')).resolves.toMatchObject({
      status: 304,
      statusText: 'Not Modified',
    });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchWithoutConsoleNoise('/api/frontend')).resolves.toMatchObject({
      status: 304,
      statusText: 'Not Modified',
    });

    const okResponse = new Response('{}', { status: 200 });
    fetchMock.mockResolvedValueOnce(okResponse);
    await expect(fetchWithoutConsoleNoise('/api/frontend')).resolves.toBe(okResponse);
  });

  it('starts Unleash with runtime config when there is no development override', async () => {
    const client = {
      isEnabled: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(UnleashClient).mockImplementationOnce(function () {
      return client;
    } as never);
    document.head.innerHTML = `
      <meta name="cacic-unleash-client-key" content="frontend-key">
      <meta name="cacic-unleash-environment" content="staging">
    `;
    const service = createService('browser');
    vi.spyOn(service as unknown as CookieBannerFeatureFlagServiceInternals, 'readDevelopmentStorageValue').mockReturnValue(
      null,
    );

    await service.initialize();

    expect(UnleashClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientKey: 'frontend-key',
        environment: 'staging',
        appName: 'cacic-voto-frontend',
        bootstrap: [
          expect.objectContaining({
            name: 'cookie-banner-enabled',
            enabled: true,
          }),
        ],
      }),
    );
    expect(client.on).toHaveBeenCalledWith('initialized', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('update', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(service.enabled()).toBe(false);
  });

  it('keeps the banner enabled when Unleash startup fails', async () => {
    const client = {
      isEnabled: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      start: vi.fn().mockRejectedValue(new Error('offline')),
    };
    vi.mocked(UnleashClient).mockImplementationOnce(function () {
      return client;
    } as never);
    const service = createService('browser');
    vi.spyOn(service as unknown as CookieBannerFeatureFlagServiceInternals, 'readDevelopmentStorageValue').mockReturnValue(
      null,
    );

    await service.initialize();

    expect(service.enabled()).toBe(true);
  });
});

function createService(platformId: 'browser' | 'server'): CookieBannerFeatureFlagService {
  TestBed.configureTestingModule({
    providers: [
      CookieBannerFeatureFlagService,
      {
        provide: PLATFORM_ID,
        useValue: platformId,
      },
    ],
  });

  return TestBed.inject(CookieBannerFeatureFlagService);
}
