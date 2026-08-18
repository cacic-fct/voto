import { UnauthorizedException } from '@nestjs/common';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/auth.constants';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  AdminPollKioskController,
  POLL_KIOSK_COOKIE_NAME,
  POLL_KIOSK_REQUEST_HEADER_VALUE,
} from './admin-poll-kiosk.controller';
import type { PollImagesService } from './poll-images.service';
import type { PollKioskAuthorizationService } from './poll-kiosk-authorization.service';
import type { PollsService } from './polls.service';

describe('AdminPollKioskController', () => {
  const context = {
    poll: { id: 'poll-1' },
    voter: {
      displayName: 'Pessoa Eleitora',
      maskedPrimaryEmail: 'pe***@example.com',
    },
    expiresAt: '2026-08-16T15:10:00.000Z',
  };
  let authorizations: {
    authorize: jest.Mock;
    discard: jest.Mock;
    getContext: jest.Mock;
    getResponseState: jest.Mock;
    readPrincipal: jest.Mock;
    submitResponse: jest.Mock;
  };
  let controller: AdminPollKioskController;
  let request: AuthenticatedRequest & { cookies: Record<string, string> };
  let response: {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };

  beforeEach(() => {
    authorizations = {
      authorize: jest.fn().mockResolvedValue({ token: 'opaque-token', context }),
      discard: jest.fn().mockResolvedValue(undefined),
      getContext: jest.fn().mockResolvedValue(context),
      getResponseState: jest.fn(),
      readPrincipal: jest.fn(),
      submitResponse: jest.fn().mockResolvedValue({ id: 'response-1' }),
    };
    controller = new AdminPollKioskController(
      authorizations as unknown as PollKioskAuthorizationService,
      {} as PollsService,
      {} as PollImagesService,
    );
    request = {
      sessionId: 'session-1',
      user: {
        sub: 'admin-1',
        roles: [],
        permissions: ['poll#kiosk'],
        scopes: [],
        oidcScopes: [],
        claims: {},
        token: 'token',
        roleSet: new Set(),
        permissionSet: new Set(['poll#kiosk']),
      },
      cookies: { [POLL_KIOSK_COOKIE_NAME]: 'previous-token' },
      headers: {},
      secure: true,
    } as unknown as AuthenticatedRequest & { cookies: Record<string, string> };
    response = { cookie: jest.fn(), clearCookie: jest.fn() };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires the dedicated kiosk permission at controller level', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AdminPollKioskController),
    ).toEqual(['poll#kiosk']);
  });

  it('sets a Strict HttpOnly poll-path cookie without exposing the voter identity', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-08-16T15:00:00.000Z').getTime(),
    );

    await expect(
      controller.authorize(
        'poll-1',
        request,
        response as never,
        POLL_KIOSK_REQUEST_HEADER_VALUE,
        { primaryEmail: 'person@example.com', totpCode: '123456' },
      ),
    ).resolves.toBe(context);
    expect(authorizations.discard).toHaveBeenCalledWith('previous-token');
    expect(response.cookie).toHaveBeenCalledWith(
      POLL_KIOSK_COOKIE_NAME,
      'opaque-token',
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        expires: new Date(context.expiresAt),
        maxAge: 600_000,
        path: '/api/admin/polls/poll-1/kiosk',
      },
    );
  });

  it('rejects mutating requests without the kiosk proof header', async () => {
    await expect(
      controller.authorize(
        'poll-1',
        request,
        response as never,
        undefined,
        { primaryEmail: 'person@example.com', totpCode: '123456' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizations.authorize).not.toHaveBeenCalled();
  });

  it('always clears the authorization cookie after a submission attempt', async () => {
    authorizations.submitResponse.mockRejectedValue(new Error('db unavailable'));

    await expect(
      controller.submitResponse(
        'poll-1',
        request,
        response as never,
        POLL_KIOSK_REQUEST_HEADER_VALUE,
        { answers: [] },
      ),
    ).rejects.toThrow('db unavailable');
    expect(response.clearCookie).toHaveBeenCalledWith(
      POLL_KIOSK_COOKIE_NAME,
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        path: '/api/admin/polls/poll-1/kiosk',
      },
    );
  });
});
