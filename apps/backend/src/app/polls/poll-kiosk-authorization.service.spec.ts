import {
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Poll, PollResponse } from '@org/voting-contracts';
import type { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { PollKioskAuthorizationService } from './poll-kiosk-authorization.service';
import type { PollsService } from './polls.service';

type RedisMock = {
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  eval: jest.Mock;
};

const poll: Poll = {
  id: 'poll-1',
  title: 'Votação',
  status: 'published',
  mode: 'regular',
  votingStyle: 'secret',
  voterEligibilitySource: 'computerScienceStudents',
  requireVerifiedUnespRole: true,
  directLinkEnabled: false,
  resultsPublic: false,
  resultsLive: false,
  allowResponseEditing: false,
  allowMultipleResponses: false,
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z',
  votingStartsAt: '2020-01-01T00:00:00.000Z',
  votingEndsAt: '2099-01-01T00:00:00.000Z',
  elements: [],
};

const admin = {
  sub: 'admin-1',
  roles: [],
  permissions: ['poll#kiosk'],
  scopes: [],
  oidcScopes: [],
  claims: {},
  token: 'admin-token',
  roleSet: new Set<string>(),
  permissionSet: new Set(['poll#kiosk']),
} satisfies AuthenticatedPrincipal;

describe('PollKioskAuthorizationService', () => {
  let redis: RedisMock;
  let prisma: { user: { upsert: jest.Mock } };
  let accountManager: { validateTotpForPrimaryEmail: jest.Mock };
  let polls: {
    getPublishedPollForKiosk: jest.Mock;
    getUserResponseState: jest.Mock;
    submitResponse: jest.Mock;
  };
  let service: PollKioskAuthorizationService;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    prisma = { user: { upsert: jest.fn().mockResolvedValue({}) } };
    accountManager = {
      validateTotpForPrimaryEmail: jest.fn().mockResolvedValue({
        profile: {
          userId: 'voter-1',
          name: 'Pessoa Eleitora',
          email: 'pessoa@example.com',
          enrollmentNumber: '261200001',
          secondaryEmails: ['pessoa@unesp.br'],
          unespRole: 'aluno-graduacao',
          unespRoleVerified: true,
        },
        serverTime: new Date('2026-08-16T15:00:00.000Z'),
        matchedStepOffset: 0,
      }),
    };
    polls = {
      getPublishedPollForKiosk: jest.fn().mockResolvedValue(poll),
      getUserResponseState: jest.fn().mockResolvedValue({
        hasSubmitted: false,
        canEdit: false,
        canSubmitAnother: false,
      }),
      submitResponse: jest.fn().mockResolvedValue({
        id: 'response-1',
        pollId: poll.id,
        answers: [],
      } satisfies PollResponse),
    };
    service = new PollKioskAuthorizationService(
      redis as never,
      prisma as unknown as PrismaService,
      accountManager as unknown as AccountManagerIntegrationService,
      polls as unknown as PollsService,
    );
  });

  it('issues an opaque authorization with fresh eligibility claims and no TOTP data', async () => {
    const issued = await service.authorize(
      poll.id,
      { primaryEmail: ' Pessoa@Example.com ', totpCode: '123456' },
      admin,
      'session-1',
    );

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issued.context).toMatchObject({
      poll,
      voter: {
        displayName: 'Pessoa Eleitora',
        maskedPrimaryEmail: 'pe****@example.com',
      },
    });
    expect(accountManager.validateTotpForPrimaryEmail).toHaveBeenCalledWith(
      'pessoa@example.com',
      '123456',
    );
    expect(polls.getPublishedPollForKiosk).toHaveBeenCalledWith(
      poll.id,
      expect.objectContaining({
        sub: 'voter-1',
        email: 'pessoa@example.com',
        claims: expect.objectContaining({
          enrollmentNumber: '261200001',
          unespRole: 'aluno-graduacao',
          unespRoleVerified: true,
        }),
      }),
    );
    const storedValue = redis.set.mock.calls.at(-1)?.[1] as string;
    expect(storedValue).not.toContain('123456');
    expect(storedValue).not.toContain(issued.token);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'voter-1' } }),
    );
  });

  it('returns the same generic failure when Account Manager rejects the credentials', async () => {
    accountManager.validateTotpForPrimaryEmail.mockResolvedValue(null);

    await expect(
      service.authorize(
        poll.id,
        { primaryEmail: 'missing@example.com', totpCode: '000000' },
        admin,
        'session-1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.set).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects a reused Account Manager TOTP time step', async () => {
    redis.set.mockResolvedValueOnce(null);

    await expect(
      service.authorize(
        poll.id,
        { primaryEmail: 'pessoa@example.com', totpCode: '123456' },
        admin,
        'session-1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(polls.getPublishedPollForKiosk).not.toHaveBeenCalled();
  });

  it('atomically consumes the authorization and submits as the voter, never the admin', async () => {
    const issued = await service.authorize(
      poll.id,
      { primaryEmail: 'pessoa@example.com', totpCode: '123456' },
      admin,
      'session-1',
    );
    const storedValue = redis.set.mock.calls.at(-1)?.[1] as string;
    redis.eval.mockResolvedValueOnce(storedValue);

    await expect(
      service.submitResponse(
        poll.id,
        issued.token,
        { answers: [] },
        admin,
        'session-1',
      ),
    ).resolves.toMatchObject({ id: 'response-1' });
    expect(polls.submitResponse).toHaveBeenCalledWith(
      poll.id,
      { answers: [] },
      expect.objectContaining({ sub: 'voter-1', email: 'pessoa@example.com' }),
    );
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("del"'),
      1,
      expect.stringContaining('cacic-voto:poll-kiosk:authorization:'),
    );
  });

  it('binds a stored authorization to its admin session and poll', async () => {
    const issued = await service.authorize(
      poll.id,
      { primaryEmail: 'pessoa@example.com', totpCode: '123456' },
      admin,
      'session-1',
    );
    redis.get.mockResolvedValue(redis.set.mock.calls.at(-1)?.[1]);

    await expect(
      service.getContext(poll.id, issued.token, admin, 'different-session'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stops before gRPC when the session attempt window is exhausted', async () => {
    redis.eval.mockResolvedValueOnce(6).mockResolvedValueOnce(6);

    await expect(
      service.authorize(
        poll.id,
        { primaryEmail: 'pessoa@example.com', totpCode: '123456' },
        admin,
        'session-1',
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(accountManager.validateTotpForPrimaryEmail).not.toHaveBeenCalled();
  });
});
