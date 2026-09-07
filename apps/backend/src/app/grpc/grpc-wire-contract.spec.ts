import { Metadata, Server, ServerCredentials } from '@grpc/grpc-js';
import { GrpcUnaryClient, loadService } from './grpc-runtime';

describe('checked-in gRPC wire contracts', () => {
  it('round-trips an omitted repeated field using the production descriptor loader', async () => {
    const service = loadService(
      'account-manager-m2m.proto',
      ['cacic', 'm2m', 'account_manager', 'v1'],
      'AccountManagerM2M',
    );
    const server = new Server();
    server.addService(
      service,
      {
        LookupUsersByEnrollment: (
          _call: unknown,
          callback: (error: Error | null, response: object) => void,
        ) => callback(null, {}),
      } as never,
    );

    const target = await new Promise<string>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(`127.0.0.1:${port}`);
      });
    });
    const client = new GrpcUnaryClient(target, service);

    try {
      await expect(
        client.call(
          'LookupUsersByEnrollment',
          { enrollmentNumbers: ['261200001'] },
          new Metadata(),
          { idempotent: false, timeoutMs: 2_000 },
        ),
      ).resolves.toEqual({});
    } finally {
      client.close();
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
    }
  });
});
