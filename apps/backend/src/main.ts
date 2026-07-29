import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { createBackendHttpApp, getBackendGlobalPrefix } from './app/bootstrap/backend-http-app';
import { startVotingGrpcServer } from './app/grpc/voting-grpc.server';

async function bootstrap() {
  const app = await createBackendHttpApp();
  await startVotingGrpcServer(app);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${getBackendGlobalPrefix()}`,
  );
}

bootstrap();
