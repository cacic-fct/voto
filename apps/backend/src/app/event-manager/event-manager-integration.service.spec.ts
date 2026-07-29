import { ServiceUnavailableException } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { EventManagerIntegrationService } from './event-manager-integration.service';
import type { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { GrpcUnaryClient } from '../grpc/grpc-runtime';

function authenticatedMetadata(accessToken: string): Metadata {
  const metadata = new Metadata();
  metadata.set('authorization', `Bearer ${accessToken}`);
  return metadata;
}

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
    expect(call).toHaveBeenCalledWith(
      'ListVotingEvents',
      {},
      authenticatedMetadata('token'),
      { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
    );
  });

  it('checks attendance through gRPC', async () => {
    call.mockResolvedValue({ attended: true });
    await expect(service.hasAttendance('event-1', 'user-1')).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith(
      'CheckVotingAttendance',
      { eventId: 'event-1', userId: 'user-1' },
      authenticatedMetadata('token'),
      { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
    );
  });

  it('rejects an invalid attendance response', async () => {
    call.mockResolvedValue({ attended: 'true' });
    await expect(service.hasAttendance('event-1', 'user-1')).rejects.toEqual(
      expect.objectContaining({ message: 'Event Manager returned an invalid attendance response.' }),
    );
  });

  it('wraps gRPC failures as service unavailable', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await expect(service.listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
