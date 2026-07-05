import axios from 'axios';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

let app: INestApplication | undefined;

beforeAll(async () => {
  ensureBackendE2eEnvironment();
  const { createBackendHttpApp } =
    require('@org/backend/http-app') as typeof import('@org/backend/http-app');
  app = await createBackendHttpApp();
  await app.listen(0);

  const address = app.getHttpServer().address() as AddressInfo | null;
  if (!address) {
    throw new Error('Expected backend E2E server to expose a listen address.');
  }

  axios.defaults.baseURL = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
  app = undefined;
  axios.defaults.baseURL = undefined;
});

function ensureBackendE2eEnvironment(): void {
  process.env['NODE_ENV'] ??= 'test';
  process.env['DATABASE_URL'] ??= 'postgresql://postgres:postgres@localhost:5432/cacic_voto_test';
  process.env['REDIS_HOST'] ??= 'localhost';
  process.env['REDIS_PORT'] ??= '6379';
}
