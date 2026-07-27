import { Metadata, status, type handleUnaryCall } from '@grpc/grpc-js';
import { BadRequestException } from '@nestjs/common';
import { KeycloakAuthService } from '../auth/keycloak-auth.service';
import { VotingLgpdService } from '../lgpd/voting-lgpd.service';
import { createVotingGrpcHandlers, toServiceError } from './voting-grpc.server';

describe('Voting gRPC LGPD handlers', () => {
  it('requires the LGPD role and passes only the requested user identifier to the collector', async () => {
    const auth = {
      authenticateMachineToMachineToken: jest.fn().mockResolvedValue({}),
    } as unknown as KeycloakAuthService;
    const lgpd = {
      collectUserData: jest.fn().mockResolvedValue({ userProfile: { id: 'requester' } }),
    } as unknown as VotingLgpdService;
    const handlers = createVotingGrpcHandlers({ auth, lgpd }) as {
      collectLgpdUserData: handleUnaryCall<Record<string, unknown>, Record<string, unknown>>;
    };
    const metadata = new Metadata();
    metadata.set('authorization', 'Bearer service-token');
    const callback = jest.fn();

    handlers.collectLgpdUserData(
      { metadata, request: { userId: ' requester ', email: 'requester@example.com' } } as never,
      callback,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(auth.authenticateMachineToMachineToken).toHaveBeenCalledWith('service-token', ['lgpd:read'], [
      'cacic-account-manager-m2m',
    ]);
    expect(lgpd.collectUserData).toHaveBeenCalledWith({ userId: 'requester', email: 'requester@example.com' });
    expect(callback).toHaveBeenCalledWith(null, { json: JSON.stringify({ userProfile: { id: 'requester' } }) });
  });

  it('does not expose unexpected error messages through gRPC', () => {
    expect(toServiceError(new BadRequestException('userId is required.'))).toMatchObject({
      code: status.INVALID_ARGUMENT,
      details: 'userId is required.',
    });
    expect(toServiceError(new Error('database secret'))).toMatchObject({
      code: status.INTERNAL,
      details: 'Internal gRPC service error.',
    });
  });
});
