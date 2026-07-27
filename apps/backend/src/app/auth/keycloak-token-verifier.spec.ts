import { Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { generateKeyPairSync, sign as signToken, type JsonWebKey, type KeyObject } from 'node:crypto';
import { KeycloakTokenVerifier, KeycloakTokenVerifierOptions } from './keycloak-token-verifier';

type TestKeyPair = {
  privateKey: KeyObject;
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string; kty: string };
};

const TEST_ISSUER = 'https://sso.example/realms/cacic';

function createKeyPair(kid: string): TestKeyPair {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: keys.privateKey,
    publicJwk: {
      ...keys.publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig',
    } as TestKeyPair['publicJwk'],
  };
}

const validKeys = createKeyPair('key-1');
const rotatedKeys = createKeyPair('key-1');
const otherKeys = createKeyPair('key-2');

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function tokenWithClaims(
  claims: Record<string, unknown> = {},
  options: {
    kid?: string;
    alg?: string;
    keys?: TestKeyPair;
    encodedPayload?: string;
  } = {},
): string {
  const keyPair = options.keys ?? validKeys;
  const encodedHeader = encodeJson({
    alg: options.alg ?? 'RS256',
    typ: 'JWT',
    kid: options.kid ?? keyPair.publicJwk.kid,
  });
  const encodedPayload =
    options.encodedPayload ??
    encodeJson({
      iss: TEST_ISSUER,
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 120,
      ...claims,
    });
  const signature = signToken('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'), keyPair.privateKey);
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

function jwksResponse(
  body: unknown,
  response: Partial<{ status: number; statusText: string }> = {},
): { data: unknown; status: number; statusText: string } {
  return {
    data: body,
    status: 200,
    statusText: 'OK',
    ...response,
  };
}

function createLogger(): jest.Mocked<Pick<Logger, 'warn'>> {
  return { warn: jest.fn() };
}

function createVerifier(options: Partial<KeycloakTokenVerifierOptions> = {}): {
  verifier: KeycloakTokenVerifier;
  logger: jest.Mocked<Pick<Logger, 'warn'>>;
} {
  const logger = createLogger();
  return {
    verifier: new KeycloakTokenVerifier({
      realmUrl: TEST_ISSUER,
      jwksCacheTtlMs: 60_000,
      jwtClockSkewSeconds: 30,
      logger: logger as unknown as Logger,
      ...options,
    }),
    logger,
  };
}

describe('KeycloakTokenVerifier', () => {
  let axiosGet: jest.SpiedFunction<typeof axios.get>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    axiosGet = jest.spyOn(axios, 'get');
    axiosGet.mockResolvedValue(jwksResponse({ keys: [validKeys.publicJwk] }) as never);
  });

  afterEach(() => {
    axiosGet.mockRestore();
    jest.useRealTimers();
  });

  it('verifies RS256 access tokens and caches JWKS keys', async () => {
    const { verifier } = createVerifier();

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ scope: 'openid' }))).resolves.toMatchObject({
      active: true,
      sub: 'user-1',
      scope: 'openid',
    });
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ sub: 'user-2' }))).resolves.toMatchObject({
      active: true,
      sub: 'user-2',
    });

    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet).toHaveBeenCalledWith(`${TEST_ISSUER}/protocol/openid-connect/certs`, {
      headers: { accept: 'application/json' },
      validateStatus: expect.any(Function),
    });
  });

  it('rejects malformed token structure and decoded JSON', async () => {
    const { verifier } = createVerifier();

    await expect(verifier.verifyAccessTokenClaims('one.two')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessTokenClaims('one..three')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessTokenClaims(`${encodeJson('bad')}.${encodeJson({})}.sig`)).rejects.toThrow(
      'Invalid token header.',
    );
    await expect(
      verifier.verifyAccessTokenClaims(`${encodeJson({ alg: 'RS256', kid: 'key-1' })}.${encodeJson('bad')}.sig`),
    ).rejects.toThrow('Invalid token payload.');
  });

  it('rejects unsupported algorithms and missing key ids', async () => {
    const { verifier } = createVerifier();

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({}, { alg: 'HS256' }))).rejects.toThrow(
      'Unsupported token signature algorithm.',
    );
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({}, { kid: '' }))).rejects.toThrow(
      'Token signing key id is missing.',
    );
  });

  it('refreshes JWKS keys for unknown key ids and failed signature checks', async () => {
    const unknownKidToken = tokenWithClaims({}, { kid: 'key-2', keys: otherKeys });
    axiosGet.mockResolvedValueOnce(jwksResponse({ keys: [validKeys.publicJwk] }) as never).mockResolvedValueOnce(
      jwksResponse({ keys: [otherKeys.publicJwk] }) as never,
    );

    await expect(createVerifier().verifier.verifyAccessTokenClaims(unknownKidToken)).resolves.toMatchObject({
      active: true,
    });
    expect(axiosGet).toHaveBeenCalledTimes(2);

    axiosGet.mockReset();
    axiosGet
      .mockResolvedValueOnce(jwksResponse({ keys: [validKeys.publicJwk] }) as never)
      .mockResolvedValueOnce(jwksResponse({ keys: [rotatedKeys.publicJwk] }) as never);

    await expect(createVerifier().verifier.verifyAccessTokenClaims(tokenWithClaims({}, { keys: rotatedKeys }))).resolves.toMatchObject({
      active: true,
    });
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid signatures after forced refresh', async () => {
    const { verifier } = createVerifier();

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({}, { keys: otherKeys, kid: 'key-1' }))).rejects.toThrow(
      'Invalid token signature.',
    );
  });

  it('rejects invalid issuer and time claims', async () => {
    const { verifier } = createVerifier();

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ iss: 'https://evil.example' }))).rejects.toThrow(
      'Invalid token issuer.',
    );
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ exp: undefined }))).rejects.toThrow(
      'Token missing expiration.',
    );
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ exp: Math.floor(Date.now() / 1000) - 31 }))).rejects.toThrow(
      'Token expired.',
    );
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ nbf: Math.floor(Date.now() / 1000) + 31 }))).rejects.toThrow(
      'Token is not active yet.',
    );
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims({ iat: Math.floor(Date.now() / 1000) + 31 }))).rejects.toThrow(
      'Token issued in the future.',
    );
  });

  it('rejects unusable JWKS responses', async () => {
    const { verifier, logger } = createVerifier();
    axiosGet.mockResolvedValueOnce(jwksResponse({}, { status: 503, statusText: 'Unavailable' }) as never);

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow('Unable to load Keycloak signing keys.');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('status=503 Unavailable'));

    axiosGet.mockResolvedValueOnce(jwksResponse({ keys: [{ kid: 'bad', kty: 'oct' }, 'not-record'] }) as never);
    await expect(createVerifier().verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow(
      'Unable to load Keycloak signing keys.',
    );

    axiosGet.mockResolvedValueOnce(
      jwksResponse({ keys: [{ kid: 'broken', kty: 'RSA', use: 'sig', alg: 'RS256' }] }) as never,
    );
    await expect(createVerifier().verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow(
      'Unable to load Keycloak signing keys.',
    );
  });

  it('logs network errors during JWKS lookup', async () => {
    const { verifier, logger } = createVerifier();
    axiosGet.mockRejectedValueOnce(new Error('offline'));

    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow('Unable to load Keycloak signing keys.');

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('message=offline'));
  });

  it('handles non-record JWKS bodies and non-Error lookup failures', async () => {
    axiosGet.mockResolvedValueOnce(jwksResponse(null) as never);
    await expect(createVerifier().verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow(
      'Unable to load Keycloak signing keys.',
    );

    const { verifier, logger } = createVerifier();
    axiosGet.mockRejectedValueOnce('offline');
    await expect(verifier.verifyAccessTokenClaims(tokenWithClaims())).rejects.toThrow('Unable to load Keycloak signing keys.');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
  });
});
