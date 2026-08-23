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
import {
  isRecord as isClaimRecord,
  parseStringList,
  readBooleanValue,
  readClaimValuesFromClaims,
  readEnrollmentNumberFromClaims,
} from './poll-user-claims';

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
  voter: StoredKioskVoterReference;
  expiresAt: string;
};

type StoredKioskVoterReference = {
  sub: string;
  /** Legacy fields are accepted while old short-lived Redis entries expire. */
  email?: string;
  name?: string;
  enrollmentNumber?: string;
  secondaryEmails?: string[];
  unespRole?: string;
  unespRoleVerified?: boolean;
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
      adminId: this.digest(this.requireAdminId(admin)),
      sessionId: this.digest(sessionId),
      voter: { sub: voter.sub },
      expiresAt: expiresAt.toISOString(),
    };

    try {
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

      // Burn the Account Manager TOTP only after all poll, response, local
      // sync, and Redis authorization checks have succeeded. If replay is
      // detected, the newly-created authorization is removed again.
      await this.reserveTotpStep(
        validated.profile.userId,
        validated.serverTime,
        validated.matchedStepOffset,
      );
    } catch (error) {
      await this.redis.del(this.authorizationKey(token)).catch(() => undefined);
      throw error;
    }
    await this.redis.del(...attemptKeys).catch((error: unknown) => {
      this.logger.warn({
        event: 'poll-kiosk-attempt-cleanup-failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.logger.log({
      event: 'poll-kiosk-authorized',
      pollId,
      adminRef: this.auditReference(stored.adminId),
      voterRef: this.auditReference(voter.sub),
    });

    return {
      token,
      context: this.toContext(poll, { ...stored, voter }),
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
    const voter = await this.loadVoter(authorization.voter);
    const poll = await this.polls.getPublishedPollForKiosk(
      pollId,
      this.toPrincipal(voter),
    );
    this.assertKioskVotingOpen(poll);
    return this.toContext(poll, { ...authorization, voter });
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
    const voter = await this.loadVoter(authorization.voter);
    return this.polls.getUserResponseState(
      pollId,
      this.toPrincipal(voter),
    );
  }

  async submitResponse(
    pollId: string,
    token: string | undefined,
    input: SubmitPollResponseDto,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<PollResponse> {
    const reservation = await this.reserveAuthorization(
      pollId,
      token,
      admin,
      sessionId,
    );
    let submitted = false;
    try {
      const voter = await this.loadVoter(reservation.authorization.voter);
      const response = await this.polls.submitResponse(
        pollId,
        input,
        this.toPrincipal(voter),
      );
      submitted = true;
      try {
        await this.finalizeAuthorization(reservation.reservationKey);
      } catch (error: unknown) {
        // The database commit is authoritative. Do not restore a token after
        // a successful vote, even if Redis finalization is temporarily down;
        // the reservation TTL is the safe one-time-use fallback.
        this.logger.warn({
          event: 'poll-kiosk-authorization-finalize-failed',
          pollId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.logger.log({
        event: 'poll-kiosk-vote-submitted',
        pollId,
        adminRef: this.auditReference(reservation.authorization.adminId),
        voterRef: this.auditReference(voter.sub),
      });
      return response;
    } catch (error) {
      if (!submitted) {
        await this.releaseAuthorization(reservation).catch((releaseError: unknown) => {
        this.logger.warn({
          event: 'poll-kiosk-authorization-release-failed',
          pollId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
        });
      }
      throw error;
    }
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
    return this.toPrincipal(await this.loadVoter(authorization.voter));
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

  private async reserveAuthorization(
    pollId: string,
    token: string | undefined,
    admin: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<{ authorization: StoredKioskAuthorization; reservationKey: string; tokenKey: string }> {
    if (!token) {
      throw new UnauthorizedException('Missing kiosk voting authorization.');
    }

    const tokenKey = this.authorizationKey(token);
    const reservationKey = this.authorizationReservationKey(token);
    const raw = await this.redis.eval(
      `
local value = redis.call("get", KEYS[1])
if value and redis.call("set", KEYS[2], value, "EX", ARGV[1], "NX") == "OK" then
  redis.call("del", KEYS[1])
  return value
end
return nil
`,
      2,
      tokenKey,
      reservationKey,
      this.authorizationTtlSeconds,
    );
    const authorization = this.parseAndAssertAuthorization(
      typeof raw === 'string' ? raw : null,
      pollId,
      admin,
      sessionId,
    );
    return { authorization, reservationKey, tokenKey };
  }

  private async finalizeAuthorization(reservationKey: string): Promise<void> {
    await this.redis.del(reservationKey);
  }

  private async releaseAuthorization(reservation: {
    authorization: StoredKioskAuthorization;
    reservationKey: string;
    tokenKey: string;
  }): Promise<void> {
    const remainingTtlSeconds = Math.max(
      1,
      Math.ceil((new Date(reservation.authorization.expiresAt).getTime() - Date.now()) / 1000),
    );
    await this.redis.eval(
      `
local value = redis.call("get", KEYS[1])
if value then
  redis.call("set", KEYS[2], value, "EX", ARGV[1], "NX")
  redis.call("del", KEYS[1])
end
return 1
`,
      2,
      reservation.reservationKey,
      reservation.tokenKey,
      remainingTtlSeconds,
    );
  }

  private async loadVoter(reference: StoredKioskVoterReference | StoredKioskVoter): Promise<StoredKioskVoter> {
    if ('email' in reference && 'name' in reference && reference.email && reference.name) {
      return {
        sub: reference.sub,
        email: reference.email,
        name: reference.name,
        ...(reference.enrollmentNumber ? { enrollmentNumber: reference.enrollmentNumber } : {}),
        ...(reference.secondaryEmails ? { secondaryEmails: reference.secondaryEmails } : {}),
        ...(reference.unespRole ? { unespRole: reference.unespRole } : {}),
        ...(reference.unespRoleVerified === undefined ? {} : { unespRoleVerified: reference.unespRoleVerified }),
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: reference.sub },
      select: {
        id: true,
        preferredUsername: true,
        email: true,
        name: true,
        claims: true,
      },
    });
    if (!user?.id || !user.email || !user.name) {
      throw new UnauthorizedException('Kiosk voter identity is no longer available.');
    }

    const claims = isClaimRecord(user.claims) ? user.claims : {};
    const secondaryEmails = readClaimValuesFromClaims(claims, ['secondary_emails', 'secondaryEmails'])
      .flatMap((value) => typeof value === 'string' ? parseStringList(value) : [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const roles = readClaimValuesFromClaims(claims, ['unesp_role', 'unespRole'])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      sub: user.id,
      email: user.email.trim().toLowerCase(),
      name: user.name.trim(),
      ...(readEnrollmentNumberFromClaims(claims)
        ? { enrollmentNumber: readEnrollmentNumberFromClaims(claims) ?? undefined }
        : {}),
      ...(secondaryEmails.length
        ? { secondaryEmails: [...new Set(secondaryEmails)] }
        : {}),
      ...(roles.length
        ? { unespRole: [...new Set(roles)].join(', ') }
        : {}),
      ...(readClaimValuesFromClaims(claims, [
        'unespRoleVerified',
        'isUnespRoleVerified',
        'unesp_role_verified',
        'is_unesp_role_verified',
      ]).length > 0
        ? { unespRoleVerified: readClaimValuesFromClaims(claims, [
          'unespRoleVerified',
          'isUnespRoleVerified',
          'unesp_role_verified',
          'is_unesp_role_verified',
        ]).some((value) => readBooleanValue(value)) }
        : {}),
    };
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
      !this.matchesBinding(authorization.adminId, this.requireAdminId(admin)) ||
      !this.matchesBinding(authorization.sessionId, sessionId) ||
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
      if (!pollId || !adminId || !sessionId || !expiresAt || !sub) {
        return null;
      }

      return {
        pollId,
        adminId,
        sessionId,
        expiresAt,
        voter: {
          sub,
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
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
    authorization: Omit<StoredKioskAuthorization, 'voter'> & { voter: StoredKioskVoter },
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

  private authorizationReservationKey(token: string): string {
    return `${this.authorizationKey(token)}:reserved`;
  }

  private auditReference(value: string): string {
    return this.digest(value).slice(0, 16);
  }

  private matchesBinding(storedValue: string, rawValue: string): boolean {
    // Accept raw values only for legacy entries while their short TTL drains;
    // all newly-issued authorizations store keyed digests in Redis.
    return storedValue === rawValue || storedValue === this.digest(rawValue);
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
