import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { getAuthSessionCookieName } from '../auth/auth.constants';

const globalPrefix = 'api';

export async function createBackendHttpApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  try {
    await configureBackendHttpApp(app);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function configureBackendHttpApp(app: INestApplication): Promise<void> {
  configureTrustedProxy(app);
  app.setGlobalPrefix(globalPrefix);
  app.enableShutdownHooks();
  // Keep authentication and ordinary mutations small. The eligibility CSV
  // endpoint is the only route that accepts a multi-megabyte JSON payload.
  app.use('/api/admin/polls/:id/eligibility-enrollments/import', json({ limit: '6mb' }));
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '64kb' }));
  app.use(requireTrustedMutationOrigin);
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
      .addCookieAuth(getAuthSessionCookieName())
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

function configureTrustedProxy(app: INestApplication): void {
  const rawHops = process.env.TRUST_PROXY_HOPS?.trim();
  if (process.env.NODE_ENV === 'production' && !rawHops) {
    throw new Error('TRUST_PROXY_HOPS must be configured in production.');
  }
  if (process.env.NODE_ENV === 'production' && !readCanonicalOrigin()) {
    throw new Error('PUBLIC_ORIGIN must be configured as an HTTPS origin in production.');
  }

  const hops = rawHops ? Number.parseInt(rawHops, 10) : 0;
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }

  const expressApp = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
  expressApp.set('trust proxy', hops);
}

function readCanonicalOrigin(): string | undefined {
  const rawOrigin = process.env.PUBLIC_ORIGIN?.trim() ?? process.env.KEYCLOAK_CANONICAL_ORIGIN?.trim();
  if (!rawOrigin) {
    return undefined;
  }
  try {
    const url = new URL(rawOrigin);
    if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
      return url.origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function requireTrustedMutationOrigin(request: Request, response: Response, next: NextFunction): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    next();
    return;
  }

  if (!hasCookie(request, getAuthSessionCookieName())) {
    next();
    return;
  }

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !readMutationOrigins().has(origin)) {
    response.status(403).json({ message: 'Untrusted request origin.' });
    return;
  }

  next();
}

function hasCookie(request: Request, cookieName: string): boolean {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((cookie) => cookie.trim().split('=', 1)[0] === cookieName);
}

export function readMutationOrigins(): Set<string> {
  const origins = new Set<string>();
  addOrigin(origins, readCanonicalOrigin());
  if (process.env.NODE_ENV !== 'production') {
    addOrigin(origins, 'http://localhost:3000');
    addOrigin(origins, 'http://localhost:4200');
  }
  const configuredOrigins = process.env.NODE_ENV === 'production'
    ? process.env.CSRF_ALLOWED_ORIGINS
    : process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS;
  for (const value of (configuredOrigins ?? '').split(',')) {
    addOrigin(origins, value.trim());
  }
  return origins;
}

function addOrigin(origins: Set<string>, rawOrigin?: string): void {
  if (!rawOrigin) {
    return;
  }
  try {
    const url = new URL(rawOrigin);
    if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
      origins.add(url.origin);
    }
  } catch {
    // Invalid origins are ignored; production startup still requires PUBLIC_ORIGIN.
  }
}
