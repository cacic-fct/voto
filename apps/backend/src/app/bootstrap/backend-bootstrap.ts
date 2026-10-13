import { Logger, type INestApplication } from '@nestjs/common';
import {
  createBackendHttpApp,
  getBackendGlobalPrefix,
} from './backend-http-app';
import { startVotingGrpcServer } from '../grpc/voting-grpc.server';
import { logBackendError } from './backend-error-logging';

export async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;
  Logger.log('Starting backend application.', 'Bootstrap');

  try {
    app = await createBackendHttpApp();
    await startVotingGrpcServer(app);
    const port = process.env.PORT || 3000;
    await app.listen(port);
    Logger.log(
      `🚀 Application is running on: http://localhost:${port}/${getBackendGlobalPrefix()}`,
      'Bootstrap',
    );
  } catch (error) {
    // Report the original failure before cleanup, which can fail or stall.
    logBackendError('Backend startup failed.', error, 'Bootstrap');
    try {
      await app?.close();
    } catch (cleanupError) {
      logBackendError(
        'Backend cleanup failed after startup error.',
        cleanupError,
        'Bootstrap',
      );
    }
    throw error;
  }
}
