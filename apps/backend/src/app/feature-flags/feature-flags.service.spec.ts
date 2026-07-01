import { FeatureFlagService } from './feature-flags.service';
import { GLOBAL_FEATURE_FLAGS } from './feature-flags.constants';

describe('FeatureFlagService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  type FeatureFlagServiceInternals = {
    fetchFlagValue(flagName: string, fallback: boolean): Promise<boolean>;
    readClientKey(): string;
    readToggleValue(payload: unknown, flagName: string): boolean | null;
    readToggleList(payload: unknown): unknown[];
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reads the global undergraduate verification disable flag from Unleash', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          toggles: [
            {
              name: GLOBAL_FEATURE_FLAGS.undergraduateUnespRoleVerificationDisabled,
              enabled: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    process.env.UNLEASH_FRONTEND_CLIENT_KEY = 'client-key';
    process.env.UNLEASH_APP_NAME = 'cacic-voto-backend-test';
    process.env.UNLEASH_ENVIRONMENT = 'production';
    const service = new FeatureFlagService();

    await expect(
      service.isUndergraduateUnespRoleVerificationDisabled(),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://unleash.cacic.dev.br/api/frontend',
      expect.any(Object),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      Authorization: 'client-key',
      'UNLEASH-APPNAME': 'cacic-voto-backend-test',
      'UNLEASH-ENVIRONMENT': 'production',
    });
  });

  it('fails closed when Unleash cannot be reached', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock.mockRejectedValue(new Error('offline'));
    global.fetch = fetchMock;
    process.env.UNLEASH_FRONTEND_CLIENT_KEY = 'client-key';
    const service = new FeatureFlagService();

    await expect(
      service.isUndergraduateUnespRoleVerificationDisabled(),
    ).resolves.toBe(false);
  });

  it('uses cached values until the configured TTL expires', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'flag-a', enabled: true }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'flag-a', enabled: false }]), {
          status: 200,
        }),
      );
    global.fetch = fetchMock;
    process.env.UNLEASH_FRONTEND_CLIENT_KEY = 'client-key';
    process.env.UNLEASH_CACHE_TTL_MS = '100';
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const service = new FeatureFlagService();

    await expect(service.isEnabled('flag-a', false)).resolves.toBe(true);
    now.mockReturnValue(1_050);
    await expect(service.isEnabled('flag-a', false)).resolves.toBe(true);
    now.mockReturnValue(1_101);
    await expect(service.isEnabled('flag-a', true)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back when the flag is missing, malformed, or returned in an error response', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ features: [{ name: 'other-flag', enabled: true }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ toggles: [{ name: 'flag-a', enabled: 'yes' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 503, statusText: 'Unavailable' }));
    global.fetch = fetchMock;
    process.env.UNLEASH_FRONTEND_CLIENT_KEY = 'client-key';
    const service = new FeatureFlagService();

    await expect(service.isEnabled('flag-a', true)).resolves.toBe(true);
    await expect(service.isEnabled('flag-b', false)).resolves.toBe(false);
    await expect(service.isEnabled('flag-c', true)).resolves.toBe(true);
  });

  it('uses URL, environment, app name, and timeout defaults defensively', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ toggles: [{ name: 'flag-a', enabled: true }] }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock;
    process.env.NODE_ENV = 'production';
    process.env.UNLEASH_API_URL = 'https://flags.example/frontend';
    process.env.UNLEASH_CACHE_TTL_MS = 'not-a-number';
    process.env.UNLEASH_TIMEOUT_MS = '-1';
    delete process.env.UNLEASH_APP_NAME;
    delete process.env.UNLEASH_CLIENT_KEY;
    delete process.env.UNLEASH_FRONTEND_CLIENT_KEY;
    delete process.env.UNLEASH_FRONTEND_API_URL;
    delete process.env.UNLEASH_ENVIRONMENT;
    const service = new FeatureFlagService();

    await expect(service.isEnabled('flag-a', false)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('https://flags.example/frontend', expect.any(Object));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      Authorization: expect.stringContaining('default:production.'),
      'UNLEASH-APPNAME': 'cacic-voto-backend',
      'UNLEASH-ENVIRONMENT': 'production',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('handles defensive private parsing branches without contacting Unleash unnecessarily', async () => {
    const service = new FeatureFlagService() as unknown as FeatureFlagServiceInternals;
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
    jest.spyOn(service, 'readClientKey').mockReturnValue('');

    await expect(service.fetchFlagValue('flag-a', true)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(service.readToggleValue([null, { name: 'flag-a', enabled: false }], 'flag-a')).toBe(false);
    expect(service.readToggleList('not-an-object')).toEqual([]);
    expect(service.readToggleList({ toggles: 'bad', features: 'bad' })).toEqual([]);
  });

  it('prefers legacy Unleash client keys when no frontend key is configured', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ features: [{ name: 'flag-a', enabled: true }] }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock;
    process.env.UNLEASH_CLIENT_KEY = 'legacy-client-key';
    delete process.env.UNLEASH_FRONTEND_CLIENT_KEY;
    const service = new FeatureFlagService();

    await expect(service.isEnabled('flag-a', false)).resolves.toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      Authorization: 'legacy-client-key',
    });
  });
});
