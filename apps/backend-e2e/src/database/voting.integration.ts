import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PollVotingStyle } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@org/backend/app/app.module';
import { configureBackendHttpApp } from '@org/backend/http-app';
import { PrismaService } from '@org/backend/app/prisma/prisma.service';
import { AuthSessionStoreService } from '@org/backend/app/auth/auth-session-store.service';
import { KeycloakAuthService } from '@org/backend/app/auth/keycloak-auth.service';
import { getAuthSessionCookieName } from '@org/backend/app/auth/auth.constants';
import { AccountManagerIntegrationService } from '@org/backend/app/account-manager/account-manager-integration.service';
import { EventManagerIntegrationService } from '@org/backend/app/event-manager/event-manager-integration.service';
import { FeatureFlagService } from '@org/backend/app/feature-flags/feature-flags.service';
import { S3Service } from '@org/backend/app/s3/s3.service';
import { PollEligibilityService } from '@org/backend/app/polls/poll-eligibility.service';
import { PollMutationsService } from '@org/backend/app/polls/poll-mutations.service';
import { PollCacicElectionService } from '@org/backend/app/polls/poll-cacic-election.service';
import { cacicElectionSlateOptionId } from '@org/backend/app/polls/poll-cacic-election.mapper';
import { CACIC_ELECTION_VOTE_ELEMENT_ID, CACIC_ELECTION_SLATE_MEMBER_ROLES } from '@org/voting-contracts';
import { PollImagesService } from '@org/backend/app/polls/poll-images.service';
import { PollResponsesService } from '@org/backend/app/polls/poll-responses.service';
import { VotingLgpdService } from '@org/backend/app/lgpd/voting-lgpd.service';
import { namespacedPollElementId } from '@org/backend/app/polls/poll-identifiers';
import { revokedSubjectHash } from '@org/backend/app/lgpd/subject-revocation';
import type { AuthenticatedPrincipal } from '@org/backend/app/auth/auth.types';

// Explicit disposable database only. No implicit .env database, migration, or service startup.
describe('real voting persistence through production HTTP middleware', () => {
  const prefix = `integrity-${randomUUID()}`;
  const users = [`${prefix}-admin`, `${prefix}-a`, `${prefix}-b`];
  const pollIds: string[] = [];
  const anonymizedUsers: string[] = [];
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  const storage = { deleteFile: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined) };
  const objectKeys: string[] = [];
  const permissions = ['poll#create', 'poll#read', 'poll#edit', 'poll#publish', 'poll#delete'];
  function runningApp(): INestApplication {
    if (!app) throw new Error('Integration application was not initialized.');
    return app;
  }
  function principal(sub: string): AuthenticatedPrincipal {
    return { sub, roles: [], scopes: [], oidcScopes: [], permissions, roleSet: new Set(), permissionSet: new Set(permissions), token: 'test', claims: {} };
  }
  function postVote(pollId: string, value: string, sub = users[1]) {
    return request(runningApp().getHttpServer()).post(`/api/polls/${pollId}/responses`)
      .set('Cookie', `${getAuthSessionCookieName()}=${sub}`).set('Origin', 'http://localhost:4200')
      .send({ answers: [{ elementId: 'question', value }] });
  }
  async function seedPoll(data: Prisma.PollUncheckedCreateInput = { title: 'Teste' }) {
    const id = `${prefix}-${pollIds.length}`;
    pollIds.push(id);
    return prisma.poll.create({ data: {
      id, status: 'PUBLISHED', votingStyle: 'PUBLIC', resultsPublic: true, resultsLive: true,
      createdById: users[0], ...data,
      elements: { create: { id: namespacedPollElementId(id, 'question'), type: 'SHORT_TEXT', title: 'Pergunta', required: true, position: 0 } },
    } });
  }
  beforeAll(async () => {
    const url = process.env.VOTING_INTEGRATION_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error('VOTING_INTEGRATION_DATABASE_URL must explicitly point to a migrated disposable database ending in _test.');
    }
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = process.env.VOTING_INTEGRATION_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
    process.env.KEYCLOAK_AUTH_SESSION_REDIS_PREFIX = `${prefix}:session:`;
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_ORIGIN = 'http://localhost:4200';
    process.env.SWAGGER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KeycloakAuthService).useValue({
        authenticateSession: async (sub: string, required: string[] = []) => {
          if (!users.includes(sub) || required.some((permission) => !permissions.includes(permission))) throw new ForbiddenException();
          return principal(sub);
        },
      })
      .overrideProvider(AccountManagerIntegrationService).useValue({
        lookupPeopleByEnrollmentNumbers: async () => [],
        lookupPeopleByIdentifiers: async (identifiers: { requestId: string; identifierValue: string }[]) => new Map(
          identifiers.map((identifier, index) => [identifier.requestId, [{
            userId: `${prefix}-member-${index}`, name: `Member ${index}`, email: identifier.identifierValue,
          }]]),
        ),
      })
      .overrideProvider(EventManagerIntegrationService).useValue({})
      .overrideProvider(FeatureFlagService).useValue({ isUndergraduateUnespRoleVerificationDisabled: async () => false })
      .overrideProvider(S3Service).useValue(storage)
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    await configureBackendHttpApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.createMany({ data: users.map((id) => ({ id, roles: [], permissions: [] })) });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.pollObjectDeletion.deleteMany({ where: { objectKey: { in: objectKeys } } });
        await prisma.pollAdminAudit.deleteMany({ where: { pollId: { in: pollIds } } });
        await prisma.poll.deleteMany({ where: { id: { in: pollIds } } });
        await prisma.user.deleteMany({ where: { id: { in: [...users, ...anonymizedUsers] } } });
        const hashes = users.map(revokedSubjectHash);
        await prisma.revokedVotingSubject.deleteMany({ where: { subjectHash: { in: hashes } } });
        await prisma.votingDeletionRequest.deleteMany({ where: { subjectHash: { in: hashes } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('executes the Redis refresh fence against deletion, lease loss, and stale generations', async () => {
    const sessions = runningApp().get(AuthSessionStoreService);
    const id = `${prefix}-refresh`;
    const original = { accessToken: 'old', refreshGeneration: 0, accessTokenExpiresAt: Date.now() + 60_000, sessionExpiresAt: Date.now() + 60_000 };
    const refreshed = { ...original, accessToken: 'new', refreshGeneration: 1 };
    try {
      await sessions.set(id, original);
      expect(await sessions.acquireRefreshLock(id, 'owner-a')).toBe(true);
      await sessions.delete(id);
      expect(await sessions.commitRefreshedSession(id, 0, 'owner-a', refreshed)).toBe(false);
      expect(await sessions.get(id)).toBeUndefined();
      await sessions.set(id, original);
      expect(await sessions.commitRefreshedSession(id, 0, 'owner-b', refreshed)).toBe(false);
      expect(await sessions.commitRefreshedSession(id, 0, 'owner-a', refreshed)).toBe(true);
      expect(await sessions.commitRefreshedSession(id, 0, 'owner-a', { ...refreshed, accessToken: 'stale' })).toBe(false);
      expect((await sessions.get(id))?.accessToken).toBe('new');
    } finally {
      await sessions.delete(id);
      await sessions.releaseRefreshLock(id, 'owner-a');
    }
  });

  it('commits exactly one single-response ballot under concurrent HTTP submissions', async () => {
    const poll = await seedPoll();
    const responses = await Promise.all(Array.from({ length: 4 }, () => postVote(poll.id, 'Sim')));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(3);
    expect(await prisma.pollResponse.count({ where: { pollId: poll.id } })).toBe(1);
    expect(await prisma.pollVoter.count({ where: { pollId: poll.id } })).toBe(1);
    expect(await prisma.pollAnswer.count({ where: { response: { pollId: poll.id } } })).toBe(1);
    expect((await postVote(poll.id, 'Não', users[2])).status).toBe(201);
  });

  it('replaces editable answers without adding a voter, and preserves multiple-response policy', async () => {
    const editable = await seedPoll({ title: 'Editável', allowResponseEditing: true });
    expect((await postVote(editable.id, 'Primeira')).status).toBe(201);
    expect((await postVote(editable.id, 'Segunda')).status).toBe(201);
    const rows = await prisma.pollResponse.findMany({ where: { pollId: editable.id }, include: { answers: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].answers).toHaveLength(1);
    expect(rows[0].answers[0].value).toBe('Segunda');
    const multiple = await seedPoll({ title: 'Múltiplas', allowMultipleResponses: true });
    expect((await postVote(multiple.id, 'Uma')).status).toBe(201);
    expect((await postVote(multiple.id, 'Outra')).status).toBe(201);
    expect(await prisma.pollResponse.count({ where: { pollId: multiple.id } })).toBe(2);
    expect(await prisma.pollVoter.count({ where: { pollId: multiple.id } })).toBe(1);
  });

  it('rolls back the voter marker when answer persistence fails', async () => {
    const poll = await seedPoll();
    const responses = runningApp().get(PollResponsesService);
    jest.spyOn(responses, 'createResponse').mockRejectedValueOnce(new Error('Injected answer failure'));
    expect((await postVote(poll.id, 'Falha')).status).toBe(500);
    expect(await prisma.pollVoter.count({ where: { pollId: poll.id } })).toBe(0);
    expect(await prisma.pollResponse.count({ where: { pollId: poll.id } })).toBe(0);
  });

  it.each([
    ['close', { status: 'CLOSED' }],
    ['definition edit', { title: 'Changed after admission' }],
    ['window expiry', { votingEndsAt: new Date(0) }],
    ['eligibility replacement', { voterEligibilitySource: 'ENROLLMENT_LIST' }],
  ] satisfies [string, Prisma.PollUncheckedUpdateInput][])('rechecks %s committed between admission and the vote transaction', async (_label, mutation) => {
    const poll = await seedPoll();
    // Interpose only at the admission/transaction seam; execute the real transaction afterward.
    const responses = runningApp().get(PollResponsesService) as unknown as {
      saveResponse(...args: unknown[]): Promise<unknown>;
    };
    const original = responses.saveResponse.bind(responses);
    jest.spyOn(responses, 'saveResponse').mockImplementation(async (...args) => {
      await prisma.poll.update({ where: { id: poll.id }, data: { ...mutation, updatedAt: new Date(poll.updatedAt.getTime() + 1_000) } });
      return original(...args);
    });
    expect((await postVote(poll.id, 'Tarde')).status).toBe(409);
    expect(await prisma.pollVoter.count({ where: { pollId: poll.id } })).toBe(0);
  });

  it('preserves anonymous storage and denies a stale principal after subject deletion', async () => {
    const poll = await seedPoll({ title: 'Anônima', votingStyle: PollVotingStyle.ANONYMOUS });
    expect((await postVote(poll.id, 'Sigiloso')).status).toBe(201);
    const stored = await prisma.pollResponse.findFirstOrThrow({ where: { pollId: poll.id } });
    expect(stored.userId).toBeNull();
    expect(stored.submittedAt).toBeNull();
    const lgpd = runningApp().get(VotingLgpdService);
    await lgpd.hardDelete({ userId: users[1], requestId: `${prefix}-delete` });
    const voter = await prisma.pollVoter.findFirstOrThrow({ where: { pollId: poll.id } });
    anonymizedUsers.push(voter.userId);
    // Auth is deliberately injected: the production vote transaction must reject this stale principal itself.
    expect((await postVote(poll.id, 'Repetido')).status).toBe(403);
    expect(await prisma.pollResponse.count({ where: { pollId: poll.id } })).toBe(1);
    await prisma.user.create({ data: { id: users[1] } });
    await prisma.revokedVotingSubject.delete({ where: { subjectHash: revokedSubjectHash(users[1]) } });
  });

  it.each(['PUBLIC', 'PARTIALLY_SECRET', 'SECRET', 'ANONYMOUS'] as const)('preserves public result disclosure for %s', async (votingStyle) => {
    const poll = await seedPoll({ title: 'Privacidade', votingStyle });
    expect((await postVote(poll.id, 'Conteúdo')).status).toBe(201);
    await prisma.poll.update({ where: { id: poll.id }, data: { status: 'CLOSED' } });
    const response = await request(runningApp().getHttpServer()).get(`/api/polls/${poll.id}/results`)
      .set('Cookie', `${getAuthSessionCookieName()}=${users[2]}`);
    expect(response.status).toBe(200);
    expect(response.body.responseCount).toBe(1);
    if (votingStyle === 'PUBLIC') {
      expect(response.body.responses).toHaveLength(1);
    } else {
      expect(response.body.responses).toEqual([]);
      expect(JSON.stringify(response.body)).not.toContain('submittedAt');
      if (votingStyle !== 'PARTIALLY_SECRET') expect(JSON.stringify(response.body)).not.toContain(users[1]);
    }
  });

  it('submits, rejects, resubmits, approves, opens voting, and freezes the election', async () => {
    const mutations = runningApp().get(PollMutationsService);
    const slates = runningApp().get(PollCacicElectionService);
    const eligibility = runningApp().get(PollEligibilityService);
    const admin = principal(users[0]);
    const voter = { ...principal(users[1]), claims: { enrollmentNumber: '241234567' } };
    const input = { title: 'Eleição', mode: 'cacicElection' as const, cacicElectionPhase: 'slateSubmission' as const, elements: [] };
    const poll = await mutations.createPoll(input, admin);
    pollIds.push(poll.id);
    await eligibility.addEligibilityEnrollments(poll.id, { enrollmentNumbers: ['241234567'] }, admin);
    const version = await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } });
    await mutations.updatePollStatus(poll.id, 'published', admin, version.updatedAt.toISOString());
    const submission = {
      name: 'Chapa de teste',
      members: CACIC_ELECTION_SLATE_MEMBER_ROLES.filter((role) => role !== 'other').map((role, index) => ({
        fullName: `Member ${index}`, role, isRepresentative: index === 0,
        identifierType: 'email' as const, identifierValue: `member${index}@example.com`,
      })),
    };
    const pending = await slates.submitCacicElectionSlate(poll.id, submission, voter);
    expect(pending.status).toBe('pending');
    await slates.rejectCacicElectionSlate(poll.id, pending.id, { reason: 'Corrigir submissão' }, admin);
    const resubmitted = await slates.submitCacicElectionSlate(poll.id, submission, voter);
    expect(resubmitted.id).toBe(pending.id);
    await slates.updateAdminCacicElectionSlate(poll.id, pending.id, { ...submission, status: 'approved' }, admin);
    const reviewed = await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } });
    await mutations.updatePoll(poll.id, {
      ...input, cacicElectionPhase: 'election', expectedUpdatedAt: reviewed.updatedAt.toISOString(),
    }, admin);
    await runningApp().get(PollResponsesService).submitResponse(poll.id, {
      answers: [{ elementId: CACIC_ELECTION_VOTE_ELEMENT_ID, value: cacicElectionSlateOptionId(pending.id) }],
    }, voter);
    const auditCount = await prisma.pollAdminAudit.count({ where: { pollId: poll.id } });
    await expect(slates.updateAdminCacicElectionSlate(poll.id, pending.id, { ...submission, name: 'Mudança tardia' }, admin)).rejects.toThrow();
    expect(await prisma.pollAdminAudit.count({ where: { pollId: poll.id } })).toBe(auditCount);
    expect(await prisma.pollResponse.count({ where: { pollId: poll.id } })).toBe(1);
    const members = await prisma.cacicElectionSlateMember.findMany({ where: { slateId: pending.id } });
    expect(members.every((member) => Boolean(member.verifiedSubjectHash))).toBe(true);
    const history = await prisma.pollAdminAudit.findMany({ where: { pollId: poll.id } });
    expect(history.length).toBeGreaterThanOrEqual(5);
    expect(history.some((event) => event.actorId === users[0])).toBe(true);
    expect(JSON.stringify(history)).not.toContain('member0@example.com');
    expect(JSON.stringify(history)).not.toContain(cacicElectionSlateOptionId(pending.id));
  });

  it('persists object cleanup across a service replacement after an S3 outage', async () => {
    const poll = await seedPoll();
    const objectKey = `${prefix}/orphan.avif`;
    objectKeys.push(objectKey);
    const image = await prisma.pollImage.create({ data: {
      pollId: poll.id, objectKey, originalFileName: 'test.png', originalMimeType: 'image/png',
      mimeType: 'image/avif', sizeBytes: 1, width: 1, height: 1,
    } });
    storage.deleteFile.mockRejectedValue(new Error('Storage unavailable'));
    await runningApp().get(PollImagesService).deletePollImage(poll.id, image.id);
    expect(await prisma.pollImage.findUnique({ where: { id: image.id } })).toBeNull();
    expect(await prisma.pollObjectDeletion.findUnique({ where: { objectKey } })).not.toBeNull();
    await prisma.pollObjectDeletion.update({ where: { objectKey }, data: { nextAttemptAt: new Date(0) } });
    storage.deleteFile.mockResolvedValue(undefined);
    const restarted = new PollImagesService(prisma, storage as unknown as S3Service);
    await restarted.retryPendingObjectDeletions();
    expect(await prisma.pollObjectDeletion.findUnique({ where: { objectKey } })).toBeNull();
    expect(storage.deleteFile).toHaveBeenLastCalledWith(objectKey);
  });

  it('uses the production cookie-origin and body-size boundary', async () => {
    const poll = await seedPoll();
    const response = await request(runningApp().getHttpServer()).post(`/api/polls/${poll.id}/responses`)
      .set('Cookie', `${getAuthSessionCookieName()}=${users[1]}`).set('Origin', 'https://untrusted.invalid')
      .send({ answers: [{ elementId: 'question', value: 'Não' }] });
    expect(response.status).toBe(403);
    const oversized = await request(runningApp().getHttpServer()).post(`/api/polls/${poll.id}/responses`)
      .set('Cookie', `${getAuthSessionCookieName()}=${users[1]}`).set('Origin', 'http://localhost:4200')
      .send({ answers: [{ elementId: 'question', value: 'x'.repeat(270_000) }] });
    expect(oversized.status).toBe(413);
    expect(await prisma.pollResponse.count({ where: { pollId: poll.id } })).toBe(0);
  });
});
