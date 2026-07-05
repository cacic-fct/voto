import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { createBackendHttpApp, getBackendGlobalPrefix } from './app/bootstrap/backend-http-app';

async function bootstrap() {
  const app = await createBackendHttpApp();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${getBackendGlobalPrefix()}`,
  );
}

bootstrap();
