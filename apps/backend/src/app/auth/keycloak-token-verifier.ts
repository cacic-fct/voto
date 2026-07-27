import { Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import {
  createPublicKey,
  type JsonWebKey,
  type KeyObject,
  verify as verifySignature,
} from 'node:crypto';
import { TokenClaims } from './auth.types';
import { isRecord, readNumberClaim, readStringClaim } from './keycloak-claims.utils';

export type KeycloakTokenVerifierOptions = {
  realmUrl: string;
  jwksCacheTtlMs: number;
  jwtClockSkewSeconds: number;
  logger: Logger;
};

export class KeycloakTokenVerifier {
  private jwksCache?: { keys: Map<string, KeyObject>; expiresAt: number };

  constructor(private readonly options: KeycloakTokenVerifierOptions) {}

  async verifyAccessTokenClaims(accessToken: string): Promise<TokenClaims> {
    const segments = accessToken.split('.');
    if (
      segments.length !== 3 ||
      segments.some((segment) => segment.length === 0)
    ) {
      throw new UnauthorizedException('Invalid token format.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = this.decodeJwtJsonSegment(encodedHeader, 'header');
    const alg = readStringClaim(header, 'alg');
    const kid = readStringClaim(header, 'kid');

    if (alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported token signature algorithm.');
    }

    if (!kid) {
      throw new UnauthorizedException('Token signing key id is missing.');
    }

    const claims = this.decodeJwtJsonSegment(encodedPayload, 'payload');
    await this.assertJwtSignature(kid, encodedHeader, encodedPayload, encodedSignature);
    this.assertJwtIssuer(claims);
    this.assertJwtTimeClaims(claims);

    return {
      ...claims,
      active: true,
    };
  }

  private async assertJwtSignature(
    kid: string,
    encodedHeader: string,
    encodedPayload: string,
    encodedSignature: string,
  ): Promise<void> {
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = this.decodeBase64UrlSegment(encodedSignature);
    const signingKey = await this.getSigningKey(kid);

    if (verifySignature('RSA-SHA256', signingInput, signingKey, signature)) {
      return;
    }

    const refreshedSigningKey = await this.getSigningKey(kid, true);
    if (verifySignature('RSA-SHA256', signingInput, refreshedSigningKey, signature)) {
      return;
    }

    throw new UnauthorizedException('Invalid token signature.');
  }

  private async getSigningKey(kid: string, forceRefresh = false): Promise<KeyObject> {
    const keys = await this.getJwksKeys(forceRefresh);
    const key = keys.get(kid);
    if (key) {
      return key;
    }

    if (!forceRefresh) {
      const refreshedKeys = await this.getJwksKeys(true);
      const refreshedKey = refreshedKeys.get(kid);
      if (refreshedKey) {
        return refreshedKey;
      }
    }

    throw new UnauthorizedException('Unable to verify token signature.');
  }

  private async getJwksKeys(forceRefresh = false): Promise<Map<string, KeyObject>> {
    const now = Date.now();
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > now) {
      return this.jwksCache.keys;
    }

    const jwksUrl = `${this.options.realmUrl}/protocol/openid-connect/certs`;

    try {
      const response = await axios.get<unknown>(jwksUrl, {
        headers: {
          accept: 'application/json',
        },
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        this.options.logger.warn(`Keycloak JWKS lookup failed. status=${response.status} ${response.statusText}.`);
        throw new UnauthorizedException('Unable to load Keycloak signing keys.');
      }

      const keys = this.parseJwks(response.data);
      if (keys.size === 0) {
        this.options.logger.warn('Keycloak JWKS response did not include usable RS256 signing keys.');
        throw new UnauthorizedException('Unable to load Keycloak signing keys.');
      }

      this.jwksCache = {
        keys,
        expiresAt: now + this.options.jwksCacheTtlMs,
      };

      return keys;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.options.logger.warn(
        `Keycloak JWKS lookup failed. ${error instanceof Error ? `message=${error.message}.` : 'unknown error.'}`,
      );
      throw new UnauthorizedException('Unable to load Keycloak signing keys.');
    }
  }

  private parseJwks(body: unknown): Map<string, KeyObject> {
    const keys = new Map<string, KeyObject>();
    if (!isRecord(body) || !Array.isArray(body['keys'])) {
      return keys;
    }

    for (const rawKey of body['keys']) {
      if (!isRecord(rawKey)) {
        continue;
      }

      const kid = readStringClaim(rawKey, 'kid');
      const kty = readStringClaim(rawKey, 'kty');
      const use = readStringClaim(rawKey, 'use');
      const alg = readStringClaim(rawKey, 'alg');
      if (!kid || kty !== 'RSA' || (use && use !== 'sig') || (alg && alg !== 'RS256')) {
        continue;
      }

      try {
        keys.set(
          kid,
          createPublicKey({
            key: { ...rawKey } as JsonWebKey,
            format: 'jwk',
          }),
        );
      } catch (error) {
        this.options.logger.warn(
          `Ignoring unusable Keycloak JWKS key. kid=${kid}; ${
            error instanceof Error ? `message=${error.message}.` : 'unknown error.'
          }`,
        );
      }
    }

    return keys;
  }

  private decodeJwtJsonSegment(segment: string, description: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.decodeBase64UrlSegment(segment).toString('utf8'));
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to a stable UnauthorizedException below.
    }

    throw new UnauthorizedException(`Invalid token ${description}.`);
  }

  private decodeBase64UrlSegment(segment: string): Buffer {
    try {
      return Buffer.from(segment, 'base64url');
    } catch {
      throw new UnauthorizedException('Invalid token encoding.');
    }
  }

  private assertJwtIssuer(claims: Record<string, unknown>): void {
    if (readStringClaim(claims, 'iss') !== this.options.realmUrl) {
      throw new UnauthorizedException('Invalid token issuer.');
    }
  }

  private assertJwtTimeClaims(claims: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    const exp = readNumberClaim(claims, 'exp');
    if (!exp) {
      throw new UnauthorizedException('Token missing expiration.');
    }

    if (exp < now - this.options.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token expired.');
    }

    const nbf = readNumberClaim(claims, 'nbf');
    if (nbf && nbf > now + this.options.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token is not active yet.');
    }

    const iat = readNumberClaim(claims, 'iat');
    if (iat && iat > now + this.options.jwtClockSkewSeconds) {
      throw new UnauthorizedException('Token issued in the future.');
    }
  }
}
