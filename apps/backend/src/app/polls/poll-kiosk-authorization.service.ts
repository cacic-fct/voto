import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountManagerPerson,
  Poll,
  PollKioskVotingContext,
  PollResponse,
  PollUserResponseState,
} from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizePollKioskVoteDto } from './dto/poll-kiosk.dto';
import { SubmitPollResponseDto } from './dto/poll.dto';
import { PollsService } from './polls.service';

const TOTP_PERIOD_MS = 30_000;
const TOTP_REPLAY_TTL_SECONDS = 2 * 60;
const DEFAULT_AUTHORIZATION_TTL_SECONDS = 10 * 60;
const DEFAULT_ATTEMPT_WINDOW_SECONDS = 5 * 60;
const DEFAULT_SESSION_ATTEMPT_LIMIT = 5;
const DEFAULT_GLOBAL_EMAIL_ATTEMPT_LIMIT = 15;

type StoredKioskAuthorization = {
  pollId: string;
  adminId: string;
  sessionId: string;
  voter: StoredKioskVoter;
  expiresAt: string;
};

type StoredKioskVoter = {
  sub: string;
  email: string;
  name: string;
  enrollmentNumber?: string;
  secondaryEmails?: string[];
  unespRole?: string;
  unespRoleVerified?: boolean;
};

export type IssuedKioskAuthorization = {
  token: string;
  context: PollKioskVotingContext;
};

@Injectable()
export class PollKioskAuthorizationService {
  private readonly logger = new Logger(PollKioskAuthorizationService.name);
  private readonly authorizationKeyPrefix =
    process.env.POLL_KIOSK_AUTHORIZATION_REDIS_PREFIX ??
    'cacic-voto:poll-kiosk:authorization:';
  private readonly attemptKeyPrefix =
    process.env.POLL_KIOSK_ATTEMPT_REDIS_PREFIX ??
    'cacic-voto:poll-kiosk:attempt:';
  private readonly replayKeyPrefix =
    process.env.POLL_KIOSK_TOTP_REPLAY_REDIS_PREFIX ??
    'cacic-voto:poll-kiosk:totp-step:';
  private readonly authorizationTtlSeconds = this.positiveInteger(
    process.env.POLL_KIOSK_AUTHORIZATION_TTL_SECONDS,
    DEFAULT_AUTHORIZATION_TTL_SECONDS,
  );
  private readonly attemptWindowSeconds = this.positiveInteger(
    process.env.POLL_KIOSK_ATTEMPT_WINDOW_SECONDS,
    DEFAULT_ATTEMPT_WINDOW_SECONDS,
  );
  private readonly sessionAttemptLimit = this.positiveInteger(
    process.env.POLL_KIOSK_SESSION_ATTEMPT_LIMIT,
    DEFAULT_SESSION_ATTEMPT_LIMIT,
  );
  private readonly globalEmailAttemptLimit = this.positiveInteger(
    process.env.POLL_KIOSK_GLOBAL_EMAIL_ATTEMPT_LIMIT,
    DEFAULT_GLOBAL_EMAIL_ATTEMPT_LIMIT,
  );

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly accountManager: AccountManagerIntegrationService,
    private readonly polls: PollsService,
  ) {}

  async authorize(
    pollId: string,
    input: AuthorizePollKioskVoteDto,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<IssuedKioskAuthorization> {
    const primaryEmail = input.primaryEmail.trim().toLowerCase();
    const attemptKeys = await this.reserveAttempt(primaryEmail, sessionId);
    const validated = await this.accountManager.validateTotpForPrimaryEmail(
      primaryEmail,
      input.totpCode,
    );
    if (!validated) {
      throw new UnauthorizedException('Invalid voter credentials.');
    }

    await this.reserveTotpStep(
      validated.profile.userId,
      validated.serverTime,
      validated.matchedStepOffset,
    );
    await this.redis.del(...attemptKeys);

    const voter = this.toStoredVoter(validated.profile);
    const principal = this.toPrincipal(voter);
    const poll = await this.polls.getPublishedPollForKiosk(pollId, principal);
    this.assertKioskVotingOpen(poll);
    const responseState = await this.polls.getUserResponseState(
      pollId,
      principal,
    );
    this.assertCanContinue(responseState);
    await this.syncLocalVoter(voter, principal.claims);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.authorizationTtlSeconds * 1000,
    );
    const stored: StoredKioskAuthorization = {
      pollId,
      adminId: this.requireAdminId(admin),
      sessionId,
      voter,
      expiresAt: expiresAt.toISOString(),
    };
    const storedResult = await this.redis.set(
      this.authorizationKey(token),
      JSON.stringify(stored),
      'EX',
      this.authorizationTtlSeconds,
      'NX',
    );
    if (storedResult !== 'OK') {
      throw new ServiceUnavailableException(
        'Could not create kiosk voting authorization.',
      );
    }

    this.logger.log({
      event: 'poll-kiosk-authorized',
      pollId,
      adminId: stored.adminId,
      voterId: voter.sub,
    });

    return {
      token,
      context: this.toContext(poll, stored),
    };
  }

  async getContext(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<PollKioskVotingContext> {
    const authorization = await this.readAuthorization(
      pollId,
      token,
      admin,
      sessionId,
    );
    const poll = await this.polls.getPublishedPollForKiosk(
      pollId,
      this.toPrincipal(authorization.voter),
    );
    this.assertKioskVotingOpen(poll);
    return this.toContext(poll, authorization);
  }

  async getResponseState(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<PollUserResponseState> {
    const authorization = await this.readAuthorization(
      pollId,
      token,
      admin,
      sessionId,
    );
    return this.polls.getUserResponseState(
      pollId,
      this.toPrincipal(authorization.voter),
    );
  }

  async submitResponse(
    pollId: string,
    token: string | undefined,
    input: SubmitPollResponseDto,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<PollResponse> {
    const authorization = await this.consumeAuthorization(
      pollId,
      token,
      admin,
      sessionId,
    );
    const response = await this.polls.submitResponse(
      pollId,
      input,
      this.toPrincipal(authorization.voter),
    );
    this.logger.log({
      event: 'poll-kiosk-vote-submitted',
      pollId,
      adminId: authorization.adminId,
      voterId: authorization.voter.sub,
    });
    return response;
  }

  async readPrincipal(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<AuthenticatedPrincipal> {
    const authorization = await this.readAuthorization(
      pollId,
      token,
      admin,
      sessionId,
    );
    return this.toPrincipal(authorization.voter);
  }

  async discard(token: string | undefined): Promise<void> {
    if (token) {
      await this.redis.del(this.authorizationKey(token));
    }
  }

  private async readAuthorization(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<StoredKioskAuthorization> {
    if (!token) {
      throw new UnauthorizedException('Missing kiosk voting authorization.');
    }

    const raw = await this.redis.get(this.authorizationKey(token));
    return this.parseAndAssertAuthorization(
      raw,
      pollId,
      admin,
      sessionId,
    );
  }

  private async consumeAuthorization(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<StoredKioskAuthorization> {
    if (!token) {
      throw new UnauthorizedException('Missing kiosk voting authorization.');
    }

    const raw = await this.redis.eval(
      `
local value = redis.call("get", KEYS[1])
if value then
  redis.call("del", KEYS[1])
end
return value
`,
      1,
      this.authorizationKey(token),
    );
    return this.parseAndAssertAuthorization(
      typeof raw === 'string' ? raw : null,
      pollId,
      admin,
      sessionId,
    );
  }

  private parseAndAssertAuthorization(
    raw: string | null,
    pollId: string,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): StoredKioskAuthorization {
    const authorization = this.parseAuthorization(raw);
    if (
      !authorization ||
      authorization.pollId !== pollId ||
      authorization.adminId !== this.requireAdminId(admin) ||
      authorization.sessionId !== sessionId ||
      new Date(authorization.expiresAt).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'Kiosk voting authorization expired or is invalid.',
      );
    }
    return authorization;
  }

  private parseAuthorization(raw: string | null): StoredKioskAuthorization | null {
    if (!raw) {
      return null;
    }
    try {
      const value = JSON.parse(raw) as unknown;
      if (!this.isRecord(value) || !this.isRecord(value['voter'])) {
        return null;
      }
      const voter = value['voter'];
      const pollId = this.stringValue(value['pollId']);
      const adminId = this.stringValue(value['adminId']);
      const sessionId = this.stringValue(value['sessionId']);
      const expiresAt = this.stringValue(value['expiresAt']);
      const sub = this.stringValue(voter['sub']);
      const email = this.stringValue(voter['email']);
      const name = this.stringValue(voter['name']);
      if (!pollId || !adminId || !sessionId || !expiresAt || !sub || !email || !name) {
        return null;
      }

      return {
        pollId,
        adminId,
        sessionId,
        expiresAt,
        voter: {
          sub,
          email,
          name,
          ...(this.stringValue(voter['enrollmentNumber'])
            ? { enrollmentNumber: this.stringValue(voter['enrollmentNumber']) }
            : {}),
          ...(this.stringArray(voter['secondaryEmails']).length
            ? { secondaryEmails: this.stringArray(voter['secondaryEmails']) }
            : {}),
          ...(this.stringValue(voter['unespRole'])
            ? { unespRole: this.stringValue(voter['unespRole']) }
            : {}),
          ...(typeof voter['unespRoleVerified'] === 'boolean'
            ? { unespRoleVerified: voter['unespRoleVerified'] }
            : {}),
        },
      };
    } catch {
      return null;
    }
  }

  private async reserveAttempt(
    primaryEmail: string,
    sessionId: string,
  ): Promise<[string, string]> {
    const emailDigest = this.digest(primaryEmail);
    const sessionKey = `${this.attemptKeyPrefix}session:${this.digest(sessionId)}:${emailDigest}`;
    const globalKey = `${this.attemptKeyPrefix}email:${emailDigest}`;
    const [sessionAttempts, globalAttempts] = await Promise.all([
      this.incrementWithExpiry(sessionKey),
      this.incrementWithExpiry(globalKey),
    ]);
    if (
      sessionAttempts > this.sessionAttemptLimit ||
      globalAttempts > this.globalEmailAttemptLimit
    ) {
      throw new HttpException(
        'Too many kiosk authentication attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return [sessionKey, globalKey];
  }

  private async incrementWithExpiry(key: string): Promise<number> {
    const result = await this.redis.eval(
      `
local value = redis.call("incr", KEYS[1])
if value == 1 then
  redis.call("expire", KEYS[1], ARGV[1])
end
return value
`,
      1,
      key,
      this.attemptWindowSeconds,
    );
    if (typeof result !== 'number') {
      throw new ServiceUnavailableException(
        'Could not enforce kiosk authentication limits.',
      );
    }
    return result;
  }

  private async reserveTotpStep(
    userId: string,
    serverTime: Date,
    matchedStepOffset: -1 | 0 | 1,
  ): Promise<void> {
    const counter = Math.floor(
      (serverTime.getTime() + matchedStepOffset * TOTP_PERIOD_MS) /
        TOTP_PERIOD_MS,
    );
    const result = await this.redis.set(
      `${this.replayKeyPrefix}${this.digest(userId)}:${counter}`,
      'used',
      'EX',
      TOTP_REPLAY_TTL_SECONDS,
      'NX',
    );
    if (result !== 'OK') {
      throw new UnauthorizedException('Invalid voter credentials.');
    }
  }

  private toStoredVoter(
    profile: AccountManagerPerson & { userId: string; email: string },
  ): StoredKioskVoter {
    return {
      sub: profile.userId,
      email: profile.email.trim().toLowerCase(),
      name: profile.name.trim(),
      ...(profile.enrollmentNumber
        ? { enrollmentNumber: profile.enrollmentNumber.trim() }
        : {}),
      ...(profile.secondaryEmails?.length
        ? { secondaryEmails: profile.secondaryEmails }
        : {}),
      ...(profile.unespRole ? { unespRole: profile.unespRole } : {}),
      ...(profile.unespRoleVerified === undefined
        ? {}
        : { unespRoleVerified: profile.unespRoleVerified }),
    };
  }

  private toPrincipal(voter: StoredKioskVoter): AuthenticatedPrincipal {
    const claims: Record<string, unknown> = {
      sub: voter.sub,
      name: voter.name,
      email: voter.email,
      ...(voter.enrollmentNumber
        ? { enrollmentNumber: voter.enrollmentNumber }
        : {}),
      ...(voter.secondaryEmails?.length
        ? { secondary_emails: voter.secondaryEmails }
        : {}),
      ...(voter.unespRole ? { unespRole: voter.unespRole } : {}),
      ...(voter.unespRoleVerified === undefined
        ? {}
        : { unespRoleVerified: voter.unespRoleVerified }),
    };
    return {
      sub: voter.sub,
      preferredUsername: voter.email,
      email: voter.email,
      roles: [],
      permissions: [],
      scopes: [],
      oidcScopes: [],
      claims,
      token: '',
      roleSet: new Set<string>(),
      permissionSet: new Set<string>(),
    };
  }

  private async syncLocalVoter(
    voter: StoredKioskVoter,
    claims: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: voter.sub },
      create: {
        id: voter.sub,
        preferredUsername: voter.email,
        email: voter.email,
        name: voter.name,
        roles: [],
        permissions: [],
        claims: claims as Prisma.InputJsonValue,
      },
      update: {
        preferredUsername: voter.email,
        email: voter.email,
        name: voter.name,
        claims: claims as Prisma.InputJsonValue,
      },
    });
  }

  private assertKioskVotingOpen(poll: Poll): void {
    const now = Date.now();
    const startsAt = poll.votingStartsAt
      ? new Date(poll.votingStartsAt).getTime()
      : Number.NEGATIVE_INFINITY;
    const endsAt = poll.votingEndsAt
      ? new Date(poll.votingEndsAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (
      poll.status !== 'published' ||
      startsAt > now ||
      endsAt <= now
    ) {
      throw new ConflictException('Poll is not accepting kiosk votes.');
    }
    if (
      poll.mode === 'cacicElection' &&
      poll.cacicElectionPhase === 'slateSubmission'
    ) {
      throw new BadRequestException(
        'Kiosk mode is not available for slate submission.',
      );
    }
  }

  private assertCanContinue(state: PollUserResponseState): void {
    if (
      state.hasSubmitted &&
      !state.canEdit &&
      !state.canSubmitAnother
    ) {
      throw new ConflictException('This voter has already voted in this poll.');
    }
  }

  private toContext(
    poll: Poll,
    authorization: StoredKioskAuthorization,
  ): PollKioskVotingContext {
    return {
      poll,
      voter: {
        displayName: authorization.voter.name,
        maskedPrimaryEmail: this.maskEmail(authorization.voter.email),
      },
      expiresAt: authorization.expiresAt,
    };
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) {
      return '***';
    }
    const visible = localPart.slice(0, Math.min(2, localPart.length));
    return `${visible}${'*'.repeat(Math.max(localPart.length - visible.length, 3))}@${domain}`;
  }

  private authorizationKey(token: string): string {
    return `${this.authorizationKeyPrefix}${this.digest(token)}`;
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  private requireAdminId(admin: AuthenticatedPrincipal): string {
    if (!admin.sub) {
      throw new UnauthorizedException('Missing authenticated administrator.');
    }
    return admin.sub;
  }

  private positiveInteger(rawValue: string | undefined, fallback: number): number {
    const value = Number.parseInt(rawValue ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
