import type { NextFunction, Request, Response } from 'express';
import { requireTrustedMutationOrigin, readMutationOrigins } from './backend-http-app';

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
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    requireTrustedMutationOrigin(request as Request, response, next);
    return { response, next };
  }

  it('accepts a development same-origin mutation with the session cookie', () => {
    const { response, next } = run({
      method: 'POST',
      headers: { cookie: 'cacic_voto_session=session-1', origin: 'http://localhost:4200' },
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('rejects a production mutation from an untrusted origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://voto.cacic.com.br';
    process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS = 'https://app.example';
    const { response, next } = run({
      method: 'POST',
      headers: { cookie: '__Host-cacic_voto_session=session-1', origin: 'https://app.example' },
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ message: 'Untrusted request origin.' });
  });

  it('does not include development origins in production allowlists', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://voto.cacic.com.br';
    process.env.KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS = 'https://app.example';

    expect(readMutationOrigins()).toEqual(new Set(['https://voto.cacic.com.br']));
  });
});
