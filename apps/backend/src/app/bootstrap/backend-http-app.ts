import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const globalPrefix = 'api';

export async function createBackendHttpApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  await configureBackendHttpApp(app);
  return app;
}

export async function configureBackendHttpApp(app: INestApplication): Promise<void> {
  app.setGlobalPrefix(globalPrefix);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (isSwaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CACiC Voto API')
      .setDescription('REST API for authentication, poll management, public polls, and vote submissions.')
      .setVersion('1.0')
      .addCookieAuth('cacic_voto_session')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document);
  }

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);
}

export function getBackendGlobalPrefix(): string {
  return globalPrefix;
}

function isSwaggerEnabled(): boolean {
  if (process.env.SWAGGER_ENABLED) {
    return process.env.SWAGGER_ENABLED === 'true';
  }

  return process.env.NODE_ENV !== 'production';
}
