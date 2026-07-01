import axios from 'axios';
import Redis from 'ioredis';

type TokenResponse = {
  accessToken: string;
  expiresIn: number;
  idToken?: string;
  refreshExpiresIn: number;
  refreshToken?: string;
};

const describeKeycloak = process.env.KEYCLOAK_BACKED_E2E === 'true' ? describe : describe.skip;
const keycloakRealmUrl = process.env.KEYCLOAK_REALM_URL ?? 'http://localhost:18080/realms/cacic-sso';
const backendHost = process.env.HOST ?? 'localhost';
const backendPort = process.env.PORT ?? '3000';
const backendBaseUrl = `http://${backendHost}:${backendPort}`;
const sessionPrefix = process.env.KEYCLOAK_AUTH_SESSION_REDIS_PREFIX ?? 'cacic-voto:auth:session:';

describeKeycloak('Keycloak-backed authentication', () => {
  const sessionIds: string[] = [];
  let redis: Redis;

  beforeAll(async () => {
    await waitForKeycloak();
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number.parseInt(process.env.REDIS_DB ?? '0', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    await redis.connect();
  });

  afterAll(async () => {
    if (redis) {
      await Promise.all(sessionIds.map((sessionId) => redis.del(`${sessionPrefix}${sessionId}`)));
      await redis.quit();
    }
  });

  it('redirects OAuth login to the imported CACiC Voto realm', async () => {
    const response = await axios.get(`${backendBaseUrl}/api/auth/login/redirect`, {
      maxRedirects: 0,
      params: {
        returnTo: '/polls',
        prompt: 'none',
      },
      validateStatus: () => true,
    });

    expect(response.status).toBe(302);
    const locationHeader = response.headers['location'];
    expect(typeof locationHeader).toBe('string');
    const location = new URL(String(locationHeader));
    expect(location.origin + location.pathname).toBe(
      `${new URL(keycloakRealmUrl).origin}/realms/cacic-sso/protocol/openid-connect/auth`,
    );
    expect(location.searchParams.get('client_id')).toBe('cacic-voto');
    expect(location.searchParams.get('redirect_uri')).toBe(`http://${backendHost}:${backendPort}/api/auth/callback`);
    expect(location.searchParams.get('prompt')).toBe('none');
    expect(location.searchParams.has('kc_idp_hint')).toBe(false);
  });

  it('authenticates live backend session cookies with real Keycloak JWT signing keys', async () => {
    const token = await requestPasswordToken('voto-admin@unesp.br', '1');
    const sessionId = `keycloak-e2e-${Date.now()}`;
    sessionIds.push(sessionId);
    const now = Date.now();

    await redis.set(
      `${sessionPrefix}${sessionId}`,
      JSON.stringify({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        idTokenHint: token.idToken,
        accessTokenExpiresAt: now + token.expiresIn * 1000,
        sessionExpiresAt: now + token.refreshExpiresIn * 1000,
      }),
      'EX',
      token.refreshExpiresIn,
    );

    const cookie = `cacic_voto_session=${encodeURIComponent(sessionId)}`;
    const meResponse = await axios.get(`${backendBaseUrl}/api/auth/me`, {
      headers: {
        Cookie: cookie,
      },
      validateStatus: () => true,
    });

    expect(meResponse.status).toBe(200);
    expect(meResponse.data).toEqual(
      expect.objectContaining({
        email: 'voto-admin@unesp.br',
        roles: expect.arrayContaining(['voting-admin']),
        claims: expect.objectContaining({
          identity_document: '11111111111',
          enrollment_number: '24123456',
        }),
      }),
    );

    const permissionsResponse = await axios.post(
      `${backendBaseUrl}/api/auth/permissions/evaluate`,
      {
        permissions: ['poll#read', 'poll#edit'],
      },
      {
        headers: {
          Cookie: cookie,
        },
        validateStatus: () => true,
      },
    );
    expect(permissionsResponse.status).toBe(201);
    expect(permissionsResponse.data).toEqual({ permissions: ['poll#read', 'poll#edit'] });

    const adminPollsResponse = await axios.get(`${backendBaseUrl}/api/admin/polls`, {
      headers: {
        Cookie: cookie,
      },
      validateStatus: () => true,
    });
    expect(adminPollsResponse.status).toBe(200);
    expect(adminPollsResponse.data).toEqual([]);
  });

  it('issues an imported service-account token for CACiC Voto M2M calls', async () => {
    const token = await requestClientCredentialsToken('cacic-voto-m2m', 'cacic-voto-m2m-dev-secret');
    const payload = decodeJwtPayload(token);

    expect(payload['azp']).toBe('cacic-voto-m2m');
    expect(payload['preferred_username']).toBe('service-account-cacic-voto-m2m');
  });
});

async function waitForKeycloak(): Promise<void> {
  const metadataUrl = `${keycloakRealmUrl}/.well-known/openid-configuration`;
  const timeoutAt = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Test Keycloak is not ready at ${metadataUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function requestPasswordToken(username: string, password: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'cacic-voto',
    client_secret: 'cacic-voto-dev-secret',
    username,
    password,
    scope: 'openid profile email',
  });

  const response = await axios.post(`${keycloakRealmUrl}/protocol/openid-connect/token`, body.toString(), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });

  return normalizeTokenResponse(response.data, 'password login');
}

async function requestClientCredentialsToken(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post(`${keycloakRealmUrl}/protocol/openid-connect/token`, body.toString(), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });

  const token = readString(response.data, 'access_token');
  if (!token) {
    throw new Error(`Keycloak did not return an access token for ${clientId}.`);
  }

  return token;
}

function normalizeTokenResponse(data: unknown, context: string): TokenResponse {
  const accessToken = readString(data, 'access_token');
  if (!accessToken) {
    throw new Error(`Keycloak did not return an access token for ${context}.`);
  }

  return {
    accessToken,
    expiresIn: readPositiveNumber(data, 'expires_in') ?? 300,
    idToken: readString(data, 'id_token'),
    refreshExpiresIn: readPositiveNumber(data, 'refresh_expires_in') ?? 300,
    refreshToken: readString(data, 'refresh_token'),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('Expected a JWT with a payload segment.');
  }

  const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!isRecord(parsed)) {
    throw new Error('Expected JWT payload to be an object.');
  }

  return parsed;
}

function readString(data: unknown, key: string): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const value = data[key];
  return typeof value === 'string' && value ? value : undefined;
}

function readPositiveNumber(data: unknown, key: string): number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const value = data[key];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
