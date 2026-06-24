import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME, IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { AuthenticatedPrincipal, AuthenticatedRequest } from './auth.types';
import { KeycloakAuthService } from './keycloak-auth.service';

type ReflectorMock = jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
type AuthMock = jest.Mocked<Pick<KeycloakAuthService, 'authenticateSession'>>;

function createContext(request: Request): ExecutionContext {
  return {
    getHandler: jest.fn(() => jest.fn()),
    getClass: jest.fn(() => class Controller {}),
    switchToHttp: jest.fn(() => ({
      getRequest: jest.fn(() => request),
    })),
  } as unknown as ExecutionContext;
}

function createUser(): AuthenticatedPrincipal {
  return {
    sub: 'user-1',
    roles: [],
    permissions: [],
    scopes: [],
    oidcScopes: [],
    claims: {},
    token: 'token',
    roleSet: new Set(),
    permissionSet: new Set(),
  };
}

describe('AuthGuard', () => {
  let reflector: ReflectorMock;
  let auth: AuthMock;
  let guard: AuthGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    auth = {
      authenticateSession: jest.fn(),
    };
    guard = new AuthGuard(reflector as unknown as Reflector, auth as unknown as KeycloakAuthService);
  });

  it('allows public requests without a session', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => key === IS_PUBLIC_KEY);

    await expect(guard.canActivate(createContext({ headers: {} } as Request))).resolves.toBe(true);
    expect(auth.authenticateSession).not.toHaveBeenCalled();
  });

  it('rejects private requests without a session', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext({ headers: {} } as Request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('authenticates sessions from parsed cookies and attaches the user', async () => {
    const user = createUser();
    const request = {
      headers: {},
      cookies: {
        [AUTH_SESSION_COOKIE_NAME]: 'session-1',
      },
    } as AuthenticatedRequest & { cookies: Record<string, string> };
    reflector.getAllAndOverride.mockImplementation((key) => (key === REQUIRED_PERMISSIONS_KEY ? ['poll#read'] : false));
    auth.authenticateSession.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(auth.authenticateSession).toHaveBeenCalledWith('session-1', ['poll#read']);
    expect(request.sessionId).toBe('session-1');
    expect(request.user).toBe(user);
  });

  it('authenticates sessions from raw cookie headers and decodes values', async () => {
    const user = createUser();
    const request = {
      headers: {
        cookie: `other=value; ${AUTH_SESSION_COOKIE_NAME}=session%3D2`,
      },
    } as AuthenticatedRequest;
    reflector.getAllAndOverride.mockReturnValue(undefined);
    auth.authenticateSession.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(auth.authenticateSession).toHaveBeenCalledWith('session=2', []);
  });

  it('ignores non-string parsed cookies and malformed raw cookie segments', async () => {
    const request = {
      headers: {
        cookie: `${AUTH_SESSION_COOKIE_NAME}; other=value`,
      },
      cookies: {
        [AUTH_SESSION_COOKIE_NAME]: 123,
      },
    } as AuthenticatedRequest & { cookies: Record<string, unknown> };
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows public requests when session authentication fails and rethrows for private requests', async () => {
    const request = {
      headers: {
        cookie: `${AUTH_SESSION_COOKIE_NAME}=session-1`,
      },
    } as AuthenticatedRequest;
    auth.authenticateSession.mockRejectedValue(new UnauthorizedException('expired'));
    reflector.getAllAndOverride.mockImplementation((key) => key === IS_PUBLIC_KEY);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    reflector.getAllAndOverride.mockImplementation((key) => (key === IS_PUBLIC_KEY ? false : []));
    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
