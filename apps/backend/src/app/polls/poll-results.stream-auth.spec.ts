import { UnauthorizedException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { KeycloakAuthService } from '../auth/keycloak-auth.service';
import { PollResultsService } from './poll-results.service';

function createUser(): AuthenticatedPrincipal {
  return {
    sub: 'user-1',
    preferredUsername: 'admin',
    email: 'admin@example.com',
    roles: [],
    permissions: ['poll#read'],
    scopes: ['openid'],
    oidcScopes: ['openid'],
    claims: {},
    token: 'token',
    sessionId: 'session-1',
    roleSet: new Set(),
    permissionSet: new Set(['poll#read']),
  };
}

describe('PollResultsService stream authorization', () => {
  const originalInterval = process.env.POLL_RESULTS_STREAM_REAUTHORIZATION_INTERVAL_MS;

  afterAll(() => {
    if (originalInterval === undefined) delete process.env.POLL_RESULTS_STREAM_REAUTHORIZATION_INTERVAL_MS;
    else process.env.POLL_RESULTS_STREAM_REAUTHORIZATION_INTERVAL_MS = originalInterval;
  });

  it('closes an idle admin stream when its session loses authorization', async () => {
    jest.useFakeTimers();
    process.env.POLL_RESULTS_STREAM_REAUTHORIZATION_INTERVAL_MS = '10';
    const user = createUser();
    const prisma = {
      pollResponse: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      pollVoter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const auth = {
      authenticateSession: jest.fn()
        .mockRejectedValueOnce(new UnauthorizedException('Session revoked.')),
    };
    const service = new PollResultsService(
      prisma as never,
      {} as never,
      undefined as never,
      undefined as never,
      auth as unknown as KeycloakAuthService,
    );
    (service as unknown as { getPollResultsMetadata: jest.Mock }).getPollResultsMetadata = jest.fn().mockResolvedValue({
      id: 'poll-1',
      status: 'PUBLISHED',
      mode: 'REGULAR',
      cacicElectionPhase: null,
      votingStyle: 'PUBLIC',
      voterEligibilitySource: 'NONE',
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: true,
      visibleFrom: null,
      votingStartsAt: null,
      votingEndsAt: null,
      publishedAt: new Date(),
      createdAt: new Date(),
    });

    const errors: unknown[] = [];
    const subscription = service.streamAdminPollResults('poll-1', undefined, user).subscribe({
      error: (error: unknown) => errors.push(error),
    });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(service.resultSubscribers.get('poll-1')).toBeDefined();

    await jest.advanceTimersByTimeAsync(10);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(auth.authenticateSession).toHaveBeenCalledWith('session-1', ['poll#read']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(UnauthorizedException);
    expect(service.resultSubscribers.has('poll-1')).toBe(false);

    subscription.unsubscribe();
    jest.useRealTimers();
  });
});
