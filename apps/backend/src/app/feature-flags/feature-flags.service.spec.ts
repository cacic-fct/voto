import { FeatureFlagService } from './feature-flags.service';
import { GLOBAL_FEATURE_FLAGS } from './feature-flags.constants';

describe('FeatureFlagService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

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
});
