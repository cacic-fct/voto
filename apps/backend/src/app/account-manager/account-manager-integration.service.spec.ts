import { ServiceUnavailableException } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { AccountManagerIntegrationService } from './account-manager-integration.service';
import type { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { GrpcUnaryClient } from '../grpc/grpc-runtime';

function authenticatedMetadata(accessToken: string): Metadata {
  const metadata = new Metadata();
  metadata.set('authorization', `Bearer ${accessToken}`);
  return metadata;
}

describe('AccountManagerIntegrationService', () => {
  const originalGrpcUrl = process.env.ACCOUNT_MANAGER_GRPC_URL;
  const tokenService = {
    getClientCredentialsToken: jest.fn().mockResolvedValue('token'),
  };
  let call: jest.SpiedFunction<GrpcUnaryClient['call']>;
  let service: AccountManagerIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCOUNT_MANAGER_GRPC_URL = 'account-manager:50051';
    call = jest.spyOn(GrpcUnaryClient.prototype, 'call');
    service = new AccountManagerIntegrationService(tokenService as unknown as KeycloakM2mTokenService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    call.mockRestore();
  });

  afterAll(() => {
    if (originalGrpcUrl === undefined) delete process.env.ACCOUNT_MANAGER_GRPC_URL;
    else process.env.ACCOUNT_MANAGER_GRPC_URL = originalGrpcUrl;
  });

  it('deduplicates enrollment numbers and maps gRPC users', async () => {
    call.mockResolvedValue({
      users: [{ userId: 'u1', enrollmentNumber: '123', name: 'Usuário', email: 'u@example.com' }],
    });

    await expect(service.lookupPeopleByEnrollmentNumbers(['123', ' 123 ', ''])).resolves.toEqual([
      { userId: 'u1', enrollmentNumber: '123', name: 'Usuário', email: 'u@example.com' },
    ]);
    expect(call).toHaveBeenCalledWith(
      'LookupUsersByEnrollment',
      { enrollmentNumbers: ['123'] },
      authenticatedMetadata('token'),
      { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
    );
  });

  it('groups identifier matches by request id', async () => {
    call.mockResolvedValue({
      users: [{ requestId: 'candidate-1', userId: 'u1', name: 'Usuário' }],
    });

    const result = await service.lookupPeopleByIdentifiers([
      { requestId: 'candidate-1', identifierType: 'email', identifierValue: 'u@example.com' },
    ]);
    expect(result.get('candidate-1')).toEqual([{ userId: 'u1', name: 'Usuário', email: null }]);
    expect(call).toHaveBeenCalledWith(
      'LookupUsersByIdentifier',
      {
        identifiers: [
          { requestId: 'candidate-1', identifierType: 'email', identifierValue: 'u@example.com' },
        ],
      },
      authenticatedMetadata('token'),
      { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
    );
  });

  it('wraps gRPC failures as service unavailable', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await expect(service.lookupPeopleByEnrollmentNumbers(['123'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('requires an Account Manager gRPC target', () => {
    delete process.env.ACCOUNT_MANAGER_GRPC_URL;
    expect(() => new AccountManagerIntegrationService(tokenService as unknown as KeycloakM2mTokenService)).toThrow(
      'ACCOUNT_MANAGER_GRPC_URL must be configured.',
    );
  });
});
