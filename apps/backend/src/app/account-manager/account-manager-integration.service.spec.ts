import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { AccountManagerIntegrationService } from './account-manager-integration.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

describe('AccountManagerIntegrationService', () => {
  const originalEnv = process.env;
  let tokens: jest.Mocked<Pick<KeycloakM2mTokenService, 'getClientCredentialsToken'>>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ACCOUNT_MANAGER_API_URL: 'https://account.example/api/',
      ACCOUNT_MANAGER_M2M_AUDIENCE: 'account-api',
      ACCOUNT_MANAGER_M2M_SCOPE: 'users',
    };
    tokens = {
      getClientCredentialsToken: jest.fn().mockResolvedValue('access-token'),
    };
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(): AccountManagerIntegrationService {
    return new AccountManagerIntegrationService(tokens as unknown as KeycloakM2mTokenService);
  }

  it('deduplicates enrollment lookup input and batches Account Manager requests', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => `2024${String(index).padStart(4, '0')}`);
    const input = [' ', ...firstBatch, firstBatch[0], '20249999'];
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          users: [{ userId: 'user-1', enrollmentNumber: ' 20240000 ', name: ' Ada ', email: ' ada@example.com ' }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ userId: 'user-2', enrollmentNumber: '20249999', name: 'Grace', email: '' }],
        },
      });

    await expect(createService().lookupPeopleByEnrollmentNumbers(input)).resolves.toEqual([
      { userId: 'user-1', enrollmentNumber: '20240000', name: 'Ada', email: 'ada@example.com' },
      { userId: 'user-2', enrollmentNumber: '20249999', name: 'Grace', email: null },
    ]);

    expect(tokens.getClientCredentialsToken).toHaveBeenCalledWith({ audience: 'account-api', scope: 'users' });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://account.example/api/v1/users/enrollment-lookup');
    expect((mockedAxios.post.mock.calls[0][1] as { enrollmentNumbers: string[] }).enrollmentNumbers).toHaveLength(500);
    expect((mockedAxios.post.mock.calls[1][1] as { enrollmentNumbers: string[] }).enrollmentNumbers).toEqual(['20249999']);
    expect(mockedAxios.post.mock.calls[0][2]).toEqual({ headers: { authorization: 'Bearer access-token' } });
  });

  it('looks up people by private identifiers without returning unmatched input', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        users: [
          {
            requestId: 'member-1',
            userId: 'user-1',
            enrollmentNumber: ' 20240001 ',
            name: ' Ada ',
            email: ' ada@example.com ',
          },
          {
            requestId: 'member-1',
            name: 'Linus',
            email: null,
          },
        ],
      },
    });

    await expect(
      createService().lookupPeopleByIdentifiers([
        { requestId: ' member-1 ', identifierType: 'email', identifierValue: ' ada@example.com ' },
        { requestId: 'member-2', identifierType: 'cpf', identifierValue: '11122233344' },
      ]),
    ).resolves.toEqual(
      new Map([
        [
          'member-1',
          [
            {
              userId: 'user-1',
              enrollmentNumber: '20240001',
              name: 'Ada',
              email: 'ada@example.com',
            },
            {
              name: 'Linus',
              email: null,
            },
          ],
        ],
      ]),
    );

    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://account.example/api/v1/users/identifier-lookup');
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({
      identifiers: [
        { requestId: 'member-1', identifierType: 'email', identifierValue: 'ada@example.com' },
        { requestId: 'member-2', identifierType: 'cpf', identifierValue: '11122233344' },
      ],
    });
  });

  it('uses the default Account Manager origin and short-circuits empty lookups', async () => {
    delete process.env.ACCOUNT_MANAGER_API_URL;

    await expect(createService().lookupPeopleByEnrollmentNumbers([' ', ''])).resolves.toEqual([]);
    await expect(createService().lookupPeopleByIdentifiers([])).resolves.toEqual(new Map());
    expect(mockedAxios.post).not.toHaveBeenCalled();

    mockedAxios.post.mockResolvedValueOnce({ data: { users: [] } });
    await expect(createService().lookupPeopleByEnrollmentNumbers(['20240001'])).resolves.toEqual([]);
    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://account.cacic.dev.br/api/v1/users/enrollment-lookup');
  });

  it('rejects invalid lookup responses and wraps request failures', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { users: 'invalid' } });
    await expect(createService().lookupPeopleByEnrollmentNumbers(['20240001'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockedAxios.post.mockResolvedValueOnce({ data: { users: [null] } });
    await expect(createService().lookupPeopleByEnrollmentNumbers(['20240001'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockedAxios.post.mockResolvedValueOnce({ data: { users: 'invalid' } });
    await expect(
      createService().lookupPeopleByIdentifiers([{ requestId: 'member-1', identifierType: 'email', identifierValue: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.post.mockResolvedValueOnce({ data: { users: [null] } });
    await expect(
      createService().lookupPeopleByIdentifiers([{ requestId: 'member-1', identifierType: 'email', identifierValue: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.post.mockResolvedValueOnce({ data: { users: [{ requestId: 'member-1', name: ' ' }] } });
    await expect(
      createService().lookupPeopleByIdentifiers([{ requestId: 'member-1', identifierType: 'email', identifierValue: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(createService().lookupPeopleByEnrollmentNumbers(['20240001'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValueOnce(new Error('offline'));
    await expect(
      createService().lookupPeopleByIdentifiers([{ requestId: 'member-1', identifierType: 'email', identifierValue: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
