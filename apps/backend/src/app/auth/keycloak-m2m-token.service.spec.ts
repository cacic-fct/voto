import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { KeycloakM2mTokenService } from './keycloak-m2m-token.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

describe('KeycloakM2mTokenService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    process.env = {
      ...originalEnv,
      KEYCLOAK_M2M_CLIENT_ID: 'm2m-client',
      KEYCLOAK_M2M_CLIENT_SECRET: 'm2m-secret',
      KEYCLOAK_REALM_URL: 'https://sso.example/realms/cacic/',
    };
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('requests and caches client credentials tokens', async () => {
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'token-1', expires_in: 120 } });
    const service = new KeycloakM2mTokenService();

    await expect(
      service.getClientCredentialsToken({ audience: 'event-manager', scope: 'events:read' }),
    ).resolves.toBe('token-1');
    await expect(
      service.getClientCredentialsToken({ audience: 'event-manager', scope: 'events:read' }),
    ).resolves.toBe('token-1');

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://sso.example/realms/cacic/protocol/openid-connect/token');
    expect(mockedAxios.post.mock.calls[0][1]).toContain('grant_type=client_credentials');
    expect(mockedAxios.post.mock.calls[0][1]).toContain('audience=event-manager');
    expect(mockedAxios.post.mock.calls[0][1]).toContain('scope=events%3Aread');
  });

  it('refreshes cached tokens inside the refresh skew and supports option credentials', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 30 } })
      .mockResolvedValueOnce({ data: { access_token: 'token-2', expires_in: 300 } });
    const service = new KeycloakM2mTokenService();

    await expect(
      service.getClientCredentialsToken({ clientId: 'override-client', clientSecret: 'override-secret' }),
    ).resolves.toBe('token-1');
    await expect(
      service.getClientCredentialsToken({ clientId: 'override-client', clientSecret: 'override-secret' }),
    ).resolves.toBe('token-2');

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][1]).toContain('client_id=override-client');
    expect(mockedAxios.post.mock.calls[0][1]).toContain('client_secret=override-secret');
  });

  it('uses a default token lifetime when Keycloak omits a positive expiry', async () => {
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'token-1', expires_in: 0 } });
    const service = new KeycloakM2mTokenService();

    await expect(service.getClientCredentialsToken()).resolves.toBe('token-1');
    jest.setSystemTime(new Date('2026-06-21T12:04:00.000Z'));
    await expect(service.getClientCredentialsToken()).resolves.toBe('token-1');

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('uses the default realm URL when none is configured', async () => {
    delete process.env.KEYCLOAK_REALM_URL;
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'token-1', expires_in: 120 } });
    const service = new KeycloakM2mTokenService();

    await service.getClientCredentialsToken();

    expect(mockedAxios.post.mock.calls[0][0]).toBe(
      'https://sso.cacic.dev.br/realms/cacic-sso/protocol/openid-connect/token',
    );
  });

  it('rejects missing credentials and invalid token responses', async () => {
    delete process.env.KEYCLOAK_M2M_CLIENT_ID;
    delete process.env.KEYCLOAK_M2M_CLIENT_SECRET;
    const service = new KeycloakM2mTokenService();

    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);

    process.env.KEYCLOAK_M2M_CLIENT_ID = 'client';
    process.env.KEYCLOAK_M2M_CLIENT_SECRET = 'secret';
    mockedAxios.post.mockResolvedValue({ data: { expires_in: 10 } });

    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('wraps Keycloak request failures', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue({ response: { status: 503 } });
    const service = new KeycloakM2mTokenService();

    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue({});
    await expect(service.getClientCredentialsToken({ audience: 'missing-status' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValue(new Error('network'));
    await expect(service.getClientCredentialsToken({ audience: 'new-cache-key' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
