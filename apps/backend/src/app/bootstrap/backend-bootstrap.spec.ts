import { Logger, type INestApplication } from '@nestjs/common';
import { bootstrap } from './backend-bootstrap';
import { createBackendHttpApp } from './backend-http-app';
import { startVotingGrpcServer } from '../grpc/voting-grpc.server';

jest.mock('./backend-http-app', () => ({
  createBackendHttpApp: jest.fn(),
  getBackendGlobalPrefix: () => 'api',
}));
jest.mock('../grpc/voting-grpc.server', () => ({
  startVotingGrpcServer: jest.fn(),
}));

describe('backend bootstrap', () => {
  const createApp = jest.mocked(createBackendHttpApp);
  const startGrpc = jest.mocked(startVotingGrpcServer);
  const app = {
    listen: jest.fn(),
    close: jest.fn(),
  };
  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    logError = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    createApp.mockResolvedValue(app as unknown as INestApplication);
    startGrpc.mockResolvedValue({} as never);
    app.listen.mockResolvedValue(undefined);
    app.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts both listeners and reports readiness after HTTP is listening', async () => {
    await bootstrap();

    expect(startGrpc).toHaveBeenCalledWith(app);
    expect(app.listen).toHaveBeenCalledWith(process.env.PORT || 3000);
    expect(Logger.log).toHaveBeenLastCalledWith(
      expect.stringContaining('/api'),
      'Bootstrap',
    );
    expect(app.close).not.toHaveBeenCalled();
  });

  it('logs application creation failures with their stack', async () => {
    const error = new Error('Provider initialization failed');
    createApp.mockRejectedValue(error);

    await expect(bootstrap()).rejects.toBe(error);

    expect(logError).toHaveBeenCalledWith(
      'Backend startup failed.',
      error.stack,
      'Bootstrap',
    );
    expect(startGrpc).not.toHaveBeenCalled();
  });

  it.each(['gRPC', 'HTTP'])(
    'logs %s failure before attempting cleanup',
    async (listener) => {
      const error = new Error(`${listener} bind failed`);
      if (listener === 'gRPC') {
        startGrpc.mockRejectedValue(error);
      } else {
        app.listen.mockRejectedValue(error);
      }
      app.close.mockImplementation(async () => {
        expect(logError).toHaveBeenCalledWith(
          'Backend startup failed.',
          error.stack,
          'Bootstrap',
        );
      });

      await expect(bootstrap()).rejects.toBe(error);
      expect(app.close).toHaveBeenCalledTimes(1);
    },
  );

  it('logs cleanup failure without replacing the startup error', async () => {
    const error = new Error('HTTP bind failed');
    const cleanupError = new Error('Redis cleanup failed');
    app.listen.mockRejectedValue(error);
    app.close.mockRejectedValue(cleanupError);

    await expect(bootstrap()).rejects.toBe(error);

    expect(logError).toHaveBeenLastCalledWith(
      'Backend cleanup failed after startup error.',
      cleanupError.stack,
      'Bootstrap',
    );
  });

  it('includes non-Error rejection details in startup logs', async () => {
    createApp.mockRejectedValue('startup rejection');

    await expect(bootstrap()).rejects.toBe('startup rejection');

    expect(logError).toHaveBeenCalledWith(
      'Backend startup failed.',
      'startup rejection',
      'Bootstrap',
    );
  });
});
