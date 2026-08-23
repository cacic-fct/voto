import { Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import { KeycloakTokenClient, KeycloakTokenClientOptions } from './keycloak-token-client';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

function createLogger(): jest.Mocked<Pick<Logger, 'warn'>> {
  return {
    warn: jest.fn(),
  };
}

function createClient(options: Partial<KeycloakTokenClientOptions> = {}): {
  client: KeycloakTokenClient;
  logger: jest.Mocked<Pick<Logger, 'warn'>>;
} {
  const logger = createLogger();
  return {
    client: new KeycloakTokenClient({
      realmUrl: 'https://sso.example/realms/cacic',
      clientId: 'voto client',
      tokenEndpointAuthMethod: 'client_secret_basic',
      defaultPostLogoutRedirectUri: 'https://app.example/login',
      failureLogSuppressionMs: 60_000,
      logger: logger as unknown as Logger,
      ...options,
    }),
    logger,
  };
}

describe('KeycloakTokenClient', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exchanges authorization codes with public-client authentication', async () => {
    const { client } = createClient();
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'access' } });

    await expect(client.exchangeCodeForTokens('code-1', 'https://app.example/callback')).resolves.toEqual({
      access_token: 'access',
    });

    const payload = mockedAxios.post.mock.calls[0][1] as string;
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://sso.example/realms/cacic/protocol/openid-connect/token',
      expect.any(String),
      expect.objectContaining({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }),
    );
    expect(payload).toContain('grant_type=authorization_code');
    expect(payload).toContain('code=code-1');
    expect(payload).toContain('redirect_uri=https%3A%2F%2Fapp.example%2Fcallback');
    expect(payload).toContain('client_id=voto+client');
  });

  it('refreshes tokens with basic client-secret authentication', async () => {
    const { client } = createClient({ clientSecret: 's:e/c r+e=t' });
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'new-access' } });

    await expect(client.refreshAccessToken('refresh-1')).resolves.toEqual({ access_token: 'new-access' });

    const payload = mockedAxios.post.mock.calls[0][1] as string;
    const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
    const expectedCredentials = Buffer.from('voto+client:s%3Ae%2Fc+r%2Be%3Dt', 'utf8').toString('base64');
    expect(payload).toBe('grant_type=refresh_token&refresh_token=refresh-1');
    expect(headers.Authorization).toBe(`Basic ${expectedCredentials}`);
  });

  it('uses client_secret_post when configured', async () => {
    const { client } = createClient({
      clientSecret: 'secret',
      tokenEndpointAuthMethod: 'client_secret_post',
    });
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'access' } });

    await client.exchangeCodeForTokens('code-1', 'bad redirect');

    const payload = mockedAxios.post.mock.calls[0][1] as string;
    const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
    expect(payload).toContain('client_id=voto+client');
    expect(payload).toContain('client_secret=secret');
    expect(headers.Authorization).toBeUndefined();
  });

  it('wraps token endpoint failures and suppresses repeated logs', async () => {
    const { client, logger } = createClient({
      clientSecret: 'secret',
      failureLogSuppressionMs: 60_000,
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue({ response: { data: { error: 'invalid_grant' } } });

    await expect(client.exchangeCodeForTokens('bad-code', 'not a url')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(client.exchangeCodeForTokens('bad-code', 'not a url')).rejects.toBeInstanceOf(UnauthorizedException);
    jest.advanceTimersByTime(60_001);
    await expect(client.exchangeCodeForTokens('bad-code', 'not a url')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0][0]).toContain('redirectUri=[invalid-url]');
    expect(logger.warn.mock.calls[1][0]).toContain('Suppressed 1 similar Keycloak failure log');
  });

  it('wraps refresh failures without axios response details', async () => {
    const { client, logger } = createClient();
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValue(new Error('network down'));

    await expect(client.refreshAccessToken('refresh-1')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('message=network down'));
  });

  it('revokes refresh tokens only when a client secret is configured', async () => {
    await expect(createClient().client.revokeRefreshToken('refresh-1')).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();

    const { client } = createClient({ clientSecret: 'secret' });
    mockedAxios.post.mockResolvedValue({});

    await expect(client.revokeRefreshToken('refresh-1')).resolves.toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://sso.example/realms/cacic/protocol/openid-connect/revoke',
      'token=refresh-1&token_type_hint=refresh_token',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
    );
  });

  it('logs and ignores refresh token revocation failures', async () => {
    const { client, logger } = createClient({ clientSecret: 'secret' });
    mockedAxios.post.mockRejectedValue('broken');

    await expect(client.revokeRefreshToken('refresh-1')).resolves.toBe(false);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('error=broken'));
  });

  it('builds logout URLs from explicit and default parameters', () => {
    expect(
      createClient().client.createLogoutUrl({
        idTokenHint: 'id-token',
      }),
    ).toBe(
      'https://sso.example/realms/cacic/protocol/openid-connect/logout?client_id=voto+client&id_token_hint=id-token&post_logout_redirect_uri=https%3A%2F%2Fapp.example%2Flogin',
    );

    expect(
      createClient({ defaultPostLogoutRedirectUri: undefined }).client.createLogoutUrl({
        postLogoutRedirectUri: 'https://app.example/bye',
      }),
    ).toBe(
      'https://sso.example/realms/cacic/protocol/openid-connect/logout?client_id=voto+client&post_logout_redirect_uri=https%3A%2F%2Fapp.example%2Fbye',
    );
  });

  it('keeps private basic credential helper defensive and logs singular suppression text', async () => {
    const { client, logger } = createClient({
      clientSecret: '',
      failureLogSuppressionMs: 1_000,
    });
    const internals = client as unknown as {
      getClientSecretBasicCredentials(): string;
    };
    expect(internals.getClientSecretBasicCredentials()).toBe('');

    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValue(new Error('offline'));
    await expect(client.refreshAccessToken('refresh-1')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(client.refreshAccessToken('refresh-1')).rejects.toBeInstanceOf(UnauthorizedException);
    jest.advanceTimersByTime(1_001);
    await expect(client.refreshAccessToken('refresh-1')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(logger.warn.mock.calls.at(-1)?.[0]).toContain('Suppressed 1 similar Keycloak failure log');
  });
});
