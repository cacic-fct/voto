import type { NextFunction, Request, Response } from 'express';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  createBackendHttpApp,
  requireTrustedMutationOrigin,
  readMutationOrigins,
} from './backend-http-app';

describe('backend HTTP app startup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.TRUST_PROXY_HOPS;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('lets Nest provider failures reach the entry point instead of aborting', async () => {
    const error = new Error('Provider creation failed');
    const create = jest.spyOn(NestFactory, 'create').mockRejectedValue(error);

    await expect(createBackendHttpApp()).rejects.toBe(error);
    expect(create).toHaveBeenCalledWith(expect.any(Function), {
      bodyParser: false,
      abortOnError: false,
    });
  });

  it('preserves and logs configuration errors when cleanup fails', async () => {
    const cleanupError = new Error('Cleanup failed');
    const logError = jest
      .spyOn(Logger, 'error')
      .mockImplementation(() => undefined);
    const app = {
      close: jest.fn(async () => {
        expect(logError).toHaveBeenCalledWith(
          'Backend HTTP configuration failed.',
          expect.stringContaining('TRUST_PROXY_HOPS must be configured'),
          'Bootstrap',
        );
        throw cleanupError;
      }),
    };
    jest
      .spyOn(NestFactory, 'create')
      .mockResolvedValue(app as unknown as INestApplication);

    await expect(createBackendHttpApp()).rejects.toThrow(
      'TRUST_PROXY_HOPS must be configured in production.',
    );
    expect(logError).toHaveBeenLastCalledWith(
      'Backend cleanup failed after configuration error.',
      cleanupError.stack,
      'Bootstrap',
    );
  });
});

describe('backend HTTP security middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.KEYCLOAK_CANONICAL_ORIGIN;
    delete process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function run(request: Partial<Request>) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    requireTrustedMutationOrigin(request as Request, response, next);
    return { response, next };
  }

  it('accepts a development same-origin mutation with the session cookie', () => {
    const { response, next } = run({
      method: 'POST',
      headers: {
        cookie: 'cacic_voto_session=session-1',
        origin: 'http://localhost:4200',
      },
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('rejects a production mutation from an untrusted origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://voto.cacic.com.br';
    process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS =
      'https://app.example';
    const { response, next } = run({
      method: 'POST',
      headers: {
        cookie: '__Host-cacic_voto_session=session-1',
        origin: 'https://app.example',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Untrusted request origin.',
    });
  });

  it('requires an allowlisted Origin for cookie-authenticated logout requests', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://voto.cacic.com.br';
    process.env.CSRF_ALLOWED_ORIGINS = 'https://app.example';

    const cookie = '__Host-cacic_voto_session=session-1';
    const missingOrigin = run({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(missingOrigin.next).not.toHaveBeenCalled();
    expect(missingOrigin.response.status).toHaveBeenCalledWith(403);

    const badOrigin = run({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://attacker.example' },
    });
    expect(badOrigin.next).not.toHaveBeenCalled();
    expect(badOrigin.response.status).toHaveBeenCalledWith(403);

    const goodOrigin = run({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://app.example' },
    });
    expect(goodOrigin.next).toHaveBeenCalledTimes(1);
    expect(goodOrigin.response.status).not.toHaveBeenCalled();
  });

  it('does not include development origins in production allowlists', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://voto.cacic.com.br';
    process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS =
      'https://app.example';

    expect(readMutationOrigins()).toEqual(
      new Set(['https://voto.cacic.com.br']),
    );
  });
});
