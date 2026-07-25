import { ServiceUnavailableException } from '@nestjs/common';
import { EventManagerIntegrationService } from './event-manager-integration.service';
import type { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { GrpcUnaryClient } from '../grpc/grpc-runtime';

describe('EventManagerIntegrationService', () => {
  const tokenService = {
    getClientCredentialsToken: jest.fn().mockResolvedValue('token'),
  };
  let call: jest.SpiedFunction<GrpcUnaryClient['call']>;
  let service: EventManagerIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    call = jest.spyOn(GrpcUnaryClient.prototype, 'call');
    service = new EventManagerIntegrationService(tokenService as unknown as KeycloakM2mTokenService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    call.mockRestore();
  });

  it('lists linkable events through gRPC', async () => {
    call.mockResolvedValue({
      events: [
        {
          id: 'event-1',
          name: 'Evento',
          startDate: '2026-07-25T10:00:00.000Z',
          endDate: '2026-07-25T12:00:00.000Z',
          shouldCollectAttendance: true,
        },
      ],
    });

    await expect(service.listLinkableEvents()).resolves.toEqual([
      {
        id: 'event-1',
        name: 'Evento',
        startDate: '2026-07-25T10:00:00.000Z',
        endDate: '2026-07-25T12:00:00.000Z',
        shouldCollectAttendance: true,
      },
    ]);
  });

  it('checks attendance through gRPC', async () => {
    call.mockResolvedValue({ attended: true });
    await expect(service.hasAttendance('event-1', 'user-1')).resolves.toBe(true);
  });

  it('wraps gRPC failures as service unavailable', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await expect(service.listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
