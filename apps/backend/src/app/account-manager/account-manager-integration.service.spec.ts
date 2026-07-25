import { ServiceUnavailableException } from '@nestjs/common';
import { AccountManagerIntegrationService } from './account-manager-integration.service';
import type { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { GrpcUnaryClient } from '../grpc/grpc-runtime';

describe('AccountManagerIntegrationService', () => {
  const tokenService = {
    getClientCredentialsToken: jest.fn().mockResolvedValue('token'),
  };
  let call: jest.SpiedFunction<GrpcUnaryClient['call']>;
  let service: AccountManagerIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    call = jest.spyOn(GrpcUnaryClient.prototype, 'call');
    service = new AccountManagerIntegrationService(tokenService as unknown as KeycloakM2mTokenService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    call.mockRestore();
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
      expect.anything(),
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
  });

  it('wraps gRPC failures as service unavailable', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await expect(service.lookupPeopleByEnrollmentNumbers(['123'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
