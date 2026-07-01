import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminCacicElectionSlate, CacicElectionSlate } from '@org/voting-contracts';
import {
  CacicElectionPhase as DbCacicElectionPhase,
  CacicElectionSlateStatus as DbCacicElectionSlateStatus,
  CacicElectionSlateSubmissionSource as DbCacicElectionSlateSubmissionSource,
  PollMode as DbPollMode,
  PollStatus as DbPollStatus,
  Prisma,
} from '@prisma/client';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  RejectCacicElectionSlateDto,
  SavePollDto,
  SubmitCacicElectionSlateDto,
  UpdateCacicElectionSlateDto,
  UpdateCacicElectionSlateEnabledDto,
} from './dto/poll.dto';
import { PollCacicElectionElementsService } from './poll-cacic-election-elements.service';
import {
  cacicElectionSlateInclude,
  toContractCacicElectionSlate,
  toDbCacicElectionSlateStatus,
} from './poll-cacic-election.mapper';
import { PollCacicElectionSlateValidatorService } from './poll-cacic-election-slate-validator.service';
import { NormalizedCacicElectionSlateMember } from './poll-cacic-election.types';
import { cleanOptionalText } from './poll-contract.mapper';

type CacicElectionPollMetadata = {
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
};

type CacicElectionSubmissionPoll = {
  status: DbPollStatus;
  visibleFrom: Date | null;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
};

@Injectable()
export class PollCacicElectionService {
  private readonly elements: PollCacicElectionElementsService;
  private readonly slateValidator: PollCacicElectionSlateValidatorService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountManager: AccountManagerIntegrationService,
    @Optional()
    elements?: PollCacicElectionElementsService,
    @Optional()
    slateValidator?: PollCacicElectionSlateValidatorService,
  ) {
    this.elements = elements ?? new PollCacicElectionElementsService();
    this.slateValidator = slateValidator ?? new PollCacicElectionSlateValidatorService(accountManager);
  }

  resolvePollElementsForSave(
    tx: Prisma.TransactionClient,
    pollId: string,
    input: SavePollDto,
    metadata: CacicElectionPollMetadata,
  ): Promise<SavePollDto['elements']> {
    return this.elements.resolvePollElementsForSave(tx, pollId, input, metadata);
  }

  async listPublicCacicElectionSlates(pollId: string, user?: AuthenticatedPrincipal): Promise<CacicElectionSlate[]> {
    this.requireAuthenticatedVoter(user);
    await this.assertPublicCacicElectionSlatePollReadable(pollId);
    const slates = await this.prisma.cacicElectionSlate.findMany({
      where: {
        pollId,
        status: DbCacicElectionSlateStatus.APPROVED,
        enabled: true,
      },
      orderBy: [{ name: 'asc' }, { submittedAt: 'asc' }],
      include: cacicElectionSlateInclude(),
    });

    return slates.map((slate) => toContractCacicElectionSlate(slate, { includePrivateIdentifiers: false }));
  }

  async getMyCacicElectionSlate(
    pollId: string,
    user?: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate | null> {
    const voter = this.requireAuthenticatedVoter(user);
    await this.assertCacicElectionSlateSubmissionOpen(pollId);
    const slate = await this.prisma.cacicElectionSlate.findUnique({
      where: {
        pollId_submittedById: {
          pollId,
          submittedById: voter.sub,
        },
      },
      include: cacicElectionSlateInclude(),
    });

    return slate ? toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true }) : null;
  }

  async submitCacicElectionSlate(
    pollId: string,
    input: SubmitCacicElectionSlateDto,
    user?: AuthenticatedPrincipal,
  ): Promise<CacicElectionSlate> {
    const voter = this.requireAuthenticatedVoter(user);
    await this.assertCacicElectionSlateSubmissionOpen(pollId);
    const name = this.slateValidator.normalizeSlateName(input.name);
    const members = await this.slateValidator.normalizeCacicElectionSlateMembers(input.members);

    try {
      const slate = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.cacicElectionSlate.findUnique({
          where: {
            pollId_submittedById: {
              pollId,
              submittedById: voter.sub,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (existing?.status === DbCacicElectionSlateStatus.APPROVED) {
          throw new ConflictException('This user already has an approved slate for this election.');
        }

        const slateId = existing?.id;
        const saved = slateId
          ? await tx.cacicElectionSlate.update({
              where: { id: slateId },
              data: {
                name,
                status: DbCacicElectionSlateStatus.PENDING,
                enabled: true,
                rejectionReason: null,
                reviewedAt: null,
                reviewedById: null,
                submittedAt: new Date(),
              },
            })
          : await tx.cacicElectionSlate.create({
              data: {
                pollId,
                name,
                status: DbCacicElectionSlateStatus.PENDING,
                enabled: true,
                submissionSource: DbCacicElectionSlateSubmissionSource.PUBLIC,
                submittedById: voter.sub,
              },
            });

        await this.replaceCacicElectionSlateMembers(tx, saved.id, members);
        return tx.cacicElectionSlate.findUniqueOrThrow({
          where: { id: saved.id },
          include: cacicElectionSlateInclude(),
        });
      });

      return toContractCacicElectionSlate(slate, { includePrivateIdentifiers: false });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('This user already submitted a slate for this election.');
      }

      throw error;
    }
  }

  async listAdminCacicElectionSlates(pollId: string): Promise<AdminCacicElectionSlate[]> {
    await this.assertCacicElectionPollExists(pollId);
    const slates = await this.prisma.cacicElectionSlate.findMany({
      where: { pollId },
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }, { name: 'asc' }],
      include: cacicElectionSlateInclude(),
    });

    return slates.map((slate) => toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true }));
  }

  async createAdminCacicElectionSlate(
    pollId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const name = this.slateValidator.normalizeSlateName(input.name);
    const members = await this.slateValidator.normalizeCacicElectionSlateMembers(input.members);
    const status = input.status ? toDbCacicElectionSlateStatus(input.status) : DbCacicElectionSlateStatus.APPROVED;

    const slate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cacicElectionSlate.create({
        data: {
          pollId,
          name,
          status,
          enabled: input.enabled ?? true,
          submissionSource: DbCacicElectionSlateSubmissionSource.ADMIN,
          adminCreatedById: user.sub,
          reviewedById: status === DbCacicElectionSlateStatus.APPROVED ? user.sub : null,
          reviewedAt: status === DbCacicElectionSlateStatus.APPROVED ? new Date() : null,
        },
      });
      await this.replaceCacicElectionSlateMembers(tx, created.id, members);
      await this.elements.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: created.id },
        include: cacicElectionSlateInclude(),
      });
    });

    return toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async updateAdminCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const name = this.slateValidator.normalizeSlateName(input.name);
    const members = await this.slateValidator.normalizeCacicElectionSlateMembers(input.members);
    const status = input.status ? toDbCacicElectionSlateStatus(input.status) : undefined;
    if (status === DbCacicElectionSlateStatus.REJECTED) {
      throw new BadRequestException('Use the rejection endpoint to reject a slate with a reason.');
    }

    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          name,
          ...(status
            ? {
                status,
                rejectionReason: null,
                reviewedById: status === DbCacicElectionSlateStatus.APPROVED ? user.sub : null,
                reviewedAt: status === DbCacicElectionSlateStatus.APPROVED ? new Date() : null,
              }
            : {}),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        },
      });
      await this.replaceCacicElectionSlateMembers(tx, updated.id, members);
      await this.elements.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: cacicElectionSlateInclude(),
      });
    });

    return toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async rejectCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: RejectCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const reason = cleanOptionalText(input.reason);
    if (!reason) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          status: DbCacicElectionSlateStatus.REJECTED,
          enabled: false,
          rejectionReason: reason,
          reviewedById: user.sub,
          reviewedAt: new Date(),
        },
      });
      await this.elements.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: cacicElectionSlateInclude(),
      });
    });

    return toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async updateCacicElectionSlateEnabled(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateEnabledDto,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          enabled: input.enabled,
        },
      });
      await this.elements.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: cacicElectionSlateInclude(),
      });
    });

    return toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async deleteCacicElectionSlate(pollId: string, slateId: string): Promise<void> {
    await this.assertCacicElectionPollExists(pollId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      await tx.cacicElectionSlate.delete({ where: { id: slateId } });
      await this.elements.refreshCacicElectionVoteElement(tx, pollId);
    });
  }

  private async assertPublicCacicElectionSlatePollReadable(pollId: string): Promise<void> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id: pollId,
        mode: DbPollMode.CACIC_ELECTION,
        ...this.publicReadablePollWhere(now),
      },
      select: { id: true },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
  }

  private async assertCacicElectionSlateSubmissionOpen(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        mode: true,
        cacicElectionPhase: true,
        status: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    if (poll.mode !== DbPollMode.CACIC_ELECTION || poll.cacicElectionPhase !== DbCacicElectionPhase.SLATE_SUBMISSION) {
      throw new BadRequestException('This poll is not accepting CACiC election slate submissions.');
    }

    if (!this.isPollVotingOpen(poll, new Date())) {
      throw new ForbiddenException('CACiC election slate submissions are closed.');
    }
  }

  private async assertCacicElectionPollExists(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        mode: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    if (poll.mode !== DbPollMode.CACIC_ELECTION) {
      throw new BadRequestException('This poll is not a CACiC election.');
    }
  }

  private async assertCacicElectionSlateBelongsToPoll(
    tx: Prisma.TransactionClient,
    pollId: string,
    slateId: string,
  ): Promise<void> {
    const slate = await tx.cacicElectionSlate.findFirst({
      where: {
        id: slateId,
        pollId,
      },
      select: { id: true },
    });

    if (!slate) {
      throw new NotFoundException('Slate not found.');
    }
  }

  private async replaceCacicElectionSlateMembers(
    tx: Prisma.TransactionClient,
    slateId: string,
    members: readonly NormalizedCacicElectionSlateMember[],
  ): Promise<void> {
    await tx.cacicElectionSlateMember.deleteMany({ where: { slateId } });
    await tx.cacicElectionSlateMember.createMany({
      data: members.map((member, position) => ({
        slateId,
        fullName: member.fullName,
        enrollmentNumber: member.enrollmentNumber,
        role: member.role,
        customRole: member.customRole,
        isRepresentative: member.isRepresentative,
        identifierType: member.identifierType,
        identifierValue: member.identifierValue,
        position,
      })),
    });
  }

  private requireAuthenticatedVoter(user?: AuthenticatedPrincipal): AuthenticatedVoter {
    if (!user?.sub) {
      throw new UnauthorizedException('Authentication is required for voting.');
    }

    return user as AuthenticatedVoter;
  }

  private publicReadablePollWhere(now: Date): Prisma.PollWhereInput {
    return {
      OR: [
        {
          status: DbPollStatus.PUBLISHED,
          OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
        },
        {
          status: DbPollStatus.CLOSED,
          resultsPublic: true,
          OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
        },
      ],
    };
  }

  private isPollVotingOpen(poll: CacicElectionSubmissionPoll, now: Date): boolean {
    return (
      poll.status === DbPollStatus.PUBLISHED &&
      (!poll.visibleFrom || poll.visibleFrom <= now) &&
      (!poll.votingStartsAt || poll.votingStartsAt <= now) &&
      (!poll.votingEndsAt || poll.votingEndsAt > now)
    );
  }

  private isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
