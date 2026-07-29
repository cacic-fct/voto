import { Metadata, status, type Client, type ServiceDefinition } from '@grpc/grpc-js';
import { GrpcUnaryClient } from './grpc-runtime';

describe('GrpcUnaryClient', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses one timeout budget for all retry attempts', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const client = new GrpcUnaryClient('localhost:50051', {
      test: {
        originalName: 'Test',
        path: '/test/Test',
      },
    } as unknown as ServiceDefinition);
    const grpcClient = (client as unknown as { client: Client }).client;
    const unavailable = Object.assign(new Error('unavailable'), { code: status.UNAVAILABLE });
    const waitForReady = jest.spyOn(grpcClient, 'waitForReady').mockImplementation((_deadline, callback) => {
      callback(unavailable);
    });

    const call = client.call('Test', {}, new Metadata(), {
      idempotent: true,
      maxAttempts: 3,
      timeoutMs: 250,
    });
    const rejection = expect(call).rejects.toBe(unavailable);
    await jest.advanceTimersByTimeAsync(100);

    await rejection;
    expect(waitForReady).toHaveBeenCalledTimes(2);
    expect(waitForReady.mock.calls.map(([deadline]) => deadline)).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(waitForReady.mock.calls[0][0]).toBe(waitForReady.mock.calls[1][0]);
    client.close();
  });
});
