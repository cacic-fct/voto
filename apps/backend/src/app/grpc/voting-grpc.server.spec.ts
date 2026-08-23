import { Metadata, status, type handleUnaryCall } from '@grpc/grpc-js';
import { BadRequestException } from '@nestjs/common';
import { KeycloakAuthService } from '../auth/keycloak-auth.service';
import { VotingLgpdService } from '../lgpd/voting-lgpd.service';
import { createVotingGrpcHandlers, toServiceError, VotingGrpcServerLifecycle } from './voting-grpc.server';

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

  it('rejects oversized, malformed, and non-canonical LGPD fields', async () => {
    const auth = {
      authenticateMachineToMachineToken: jest.fn().mockResolvedValue({}),
    } as unknown as KeycloakAuthService;
    const lgpd = {
      collectUserData: jest.fn(),
    } as unknown as VotingLgpdService;
    const handlers = createVotingGrpcHandlers({ auth, lgpd }) as {
      collectLgpdUserData: handleUnaryCall<Record<string, unknown>, Record<string, unknown>>;
      scheduleLgpdDeletion: handleUnaryCall<Record<string, unknown>, Record<string, unknown>>;
    };
    const metadata = new Metadata();
    metadata.set('authorization', 'Bearer service-token');

    const collectCallback = jest.fn();
    handlers.collectLgpdUserData(
      { metadata, request: { userId: 'x'.repeat(257), email: 'valid@example.com' } } as never,
      collectCallback,
    );
    const scheduleCallback = jest.fn();
    handlers.scheduleLgpdDeletion(
      { metadata, request: { requestId: 'bad request id', userId: 'user-1', email: 'invalid' } } as never,
      scheduleCallback,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(collectCallback.mock.calls[0]?.[0]).toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(scheduleCallback.mock.calls[0]?.[0]).toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(lgpd.collectUserData).not.toHaveBeenCalled();
  });

  it('forces gRPC shutdown after the configured deadline', async () => {
    jest.useFakeTimers();
    const server = {
      tryShutdown: jest.fn(),
      forceShutdown: jest.fn(),
    };
    process.env.VOTING_GRPC_SHUTDOWN_TIMEOUT_MS = '10';
    const lifecycle = new VotingGrpcServerLifecycle();
    lifecycle.register(server as never);

    const shutdown = lifecycle.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(10);
    await shutdown;

    expect(server.tryShutdown).toHaveBeenCalledTimes(1);
    expect(server.forceShutdown).toHaveBeenCalledTimes(1);
    delete process.env.VOTING_GRPC_SHUTDOWN_TIMEOUT_MS;
    jest.useRealTimers();
  });

  it('clears the shutdown deadline after graceful completion', async () => {
    jest.useFakeTimers();
    const server = {
      tryShutdown: jest.fn((callback: () => void) => callback()),
      forceShutdown: jest.fn(),
    };
    process.env.VOTING_GRPC_SHUTDOWN_TIMEOUT_MS = '10';
    const lifecycle = new VotingGrpcServerLifecycle();
    lifecycle.register(server as never);

    await lifecycle.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(20);

    expect(server.forceShutdown).not.toHaveBeenCalled();
    delete process.env.VOTING_GRPC_SHUTDOWN_TIMEOUT_MS;
    jest.useRealTimers();
  });
});
