import 'dotenv/config';
import { Logger, type INestApplication } from '@nestjs/common';
import type { Server } from '@grpc/grpc-js';
import { createBackendHttpApp, getBackendGlobalPrefix } from './app/bootstrap/backend-http-app';
import { startVotingGrpcServer, shutdownVotingGrpcServer } from './app/grpc/voting-grpc.server';

export async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;
  let grpcServer: Server | undefined;
  try {
    app = await createBackendHttpApp();
    grpcServer = await startVotingGrpcServer(app);
    const port = process.env.PORT || 3000;
    await app.listen(port);
    Logger.log(
      `🚀 Application is running on: http://localhost:${port}/${getBackendGlobalPrefix()}`,
    );
  } catch (error) {
    try {
      if (app) {
        await app.close();
      } else if (grpcServer) {
        await shutdownVotingGrpcServer(grpcServer);
      }
    } catch (cleanupError) {
      Logger.error(
        `Backend cleanup failed after startup error: ${cleanupError instanceof Error ? cleanupError.message : 'unknown error'}`,
      );
    }
    throw error;
  }
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    Logger.error(
      `Backend startup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exitCode = 1;
  });
}
