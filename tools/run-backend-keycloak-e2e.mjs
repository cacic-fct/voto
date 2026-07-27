import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const rootDir = new URL('..', import.meta.url).pathname;
const composeFile = 'docker/docker-compose.keycloak.test.yml';
const keycloakPort = process.env.KEYCLOAK_TEST_PORT || '18080';
const keycloakUrl = `http://localhost:${keycloakPort}`;
const backendHost = process.env.HOST || 'localhost';
const backendPort = process.env.PORT || '3000';
const keepContainer = process.env.KEYCLOAK_TEST_KEEPALIVE === 'true';
const nxE2eArgs = process.argv.slice(2);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

function dockerCompose(args) {
  run('docker', ['compose', '-f', composeFile, ...args]);
}

async function waitForUrl(url, label, timeoutMs = 120_000) {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
      });
      if (response.ok || response.status === 303) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  throw new Error(
    `Timed out waiting for ${label} at ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function buildTestEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    HOST: backendHost,
    PORT: backendPort,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/cacic_voto_test',
    REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
    REDIS_PORT: process.env.REDIS_PORT ?? '6379',
    KEYCLOAK_BACKED_E2E: 'true',
    KEYCLOAK_REALM_URL: `${keycloakUrl}/realms/cacic-sso`,
    KEYCLOAK_CLIENT_ID: 'cacic-voto',
    KEYCLOAK_CLIENT_SECRET: 'cacic-voto-dev-secret',
    KEYCLOAK_REDIRECT_URI: `http://${backendHost}:${backendPort}/api/auth/callback`,
    KEYCLOAK_POST_LOGIN_REDIRECT_URI: 'http://localhost:4200/',
    KEYCLOAK_POST_LOGOUT_REDIRECT_URI: 'http://localhost:4200/login',
    KEYCLOAK_AUTH_SESSION_REDIS_PREFIX: 'cacic-voto:test:auth:session:',
    KEYCLOAK_JWT_CLOCK_SKEW_SECONDS: '60',
    KEYCLOAK_M2M_CLIENT_ID: 'cacic-voto-m2m',
    KEYCLOAK_M2M_CLIENT_SECRET: 'cacic-voto-m2m-dev-secret',
    ACCOUNT_MANAGER_GRPC_URL: process.env.ACCOUNT_MANAGER_GRPC_URL ?? 'localhost:50053',
    ACCOUNT_MANAGER_M2M_AUDIENCE: 'cacic-account-manager-audience',
    EVENT_MANAGER_M2M_AUDIENCE: 'cacic-event-manager-audience',
  };
}

async function main() {
  const testEnv = buildTestEnv();
  dockerCompose(['down', '-v', '--remove-orphans']);
  dockerCompose(['up', '-d']);

  await waitForUrl(`${keycloakUrl}/realms/cacic-sso/.well-known/openid-configuration`, 'test Keycloak');

  run(
    process.platform === 'win32' ? 'bunx.cmd' : 'bunx',
    ['nx', 'e2e', 'backend-e2e', '--runInBand', ...nxE2eArgs],
    {
      env: testEnv,
    },
  );
}

try {
  await main();
} finally {
  if (!keepContainer) {
    dockerCompose(['down', '-v', '--remove-orphans']);
  }
}
