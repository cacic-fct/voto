import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isRecord, readEnrollmentNumberFromClaims } from '../polls/poll-user-claims';

type LgpdUserInput = {
  userId: string;
  email?: string;
};

type LgpdDeletionInput = LgpdUserInput & {
  requestId: string;
};

@Injectable()
export class VotingLgpdService {
  private readonly logger = new Logger(VotingLgpdService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collectUserData(input: LgpdUserInput): Promise<Record<string, unknown>> {
    const [user, responses, votes, managedPolls, electionSlates] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          preferredUsername: true,
          email: true,
          name: true,
          roles: true,
          permissions: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          claims: true,
        },
      }),
      this.prisma.pollResponse.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          pollId: true,
          submittedAt: true,
          createdAt: true,
          answers: {
            select: {
              elementId: true,
              value: true,
            },
          },
        },
      }),
      this.prisma.pollVoter.findMany({
        where: { userId: input.userId },
        select: {
          pollId: true,
        },
      }),
      this.prisma.poll.findMany({
        where: {
          OR: [{ createdById: input.userId }, { updatedById: input.userId }],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          mode: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          updatedById: true,
        },
      }),
      this.prisma.cacicElectionSlate.findMany({
        where: {
          OR: [
            { submittedById: input.userId },
            { adminCreatedById: input.userId },
            { reviewedById: input.userId },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          pollId: true,
          status: true,
          enabled: true,
          submissionSource: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          submittedById: true,
          adminCreatedById: true,
          reviewedById: true,
        },
      }),
    ]);

    const claims = user && isRecord(user.claims) ? user.claims : {};
    const enrollmentNumber = readEnrollmentNumberFromClaims(claims);
    const userProfile = user
      ? Object.fromEntries(Object.entries(user).filter(([key]) => key !== 'claims'))
      : null;
    const [eligibilityEntries, emailSlateMembers] = await Promise.all([
      enrollmentNumber
        ? this.prisma.pollEligibilityEnrollment.findMany({
            where: { enrollmentNumber },
            select: { pollId: true, enrollmentNumber: true, createdAt: true },
          })
        : Promise.resolve([]),
      user?.email
        ? this.prisma.cacicElectionSlateMember.findMany({
            where: {
              identifierType: 'EMAIL',
              identifierValue: user.email.trim().toLowerCase(),
            },
            select: {
              id: true,
              slateId: true,
              fullName: true,
              enrollmentNumber: true,
              role: true,
              customRole: true,
              isRepresentative: true,
              identifierType: true,
              identifierValue: true,
              position: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      metadata: {
        source: 'cacic_voto',
        generatedAt: new Date().toISOString(),
        userId: input.userId,
        note: 'Records are selected by Account Manager user ID plus canonical enrollment/email references for identity data that predates a user foreign key.',
      },
      userProfile,
      pollResponses: responses,
      pollVotes: votes,
      pollManagement: managedPolls.map(({ createdById, updatedById, ...poll }) => ({
        ...poll,
        createdByRequester: createdById === input.userId,
        updatedByRequester: updatedById === input.userId,
      })),
      cacicElectionSlateActivities: electionSlates.map(
        ({ submittedById, adminCreatedById, reviewedById, ...slate }) => ({
          ...slate,
          submittedByRequester: submittedById === input.userId,
          adminCreatedByRequester: adminCreatedById === input.userId,
          reviewedByRequester: reviewedById === input.userId,
        }),
      ),
      unlinkedEligibilityEnrollments: eligibilityEntries,
      unlinkedCacicElectionSlateMembers: emailSlateMembers,
    };
  }

  async scheduleDeletion(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    this.validateDeletionInput(input);
    throw new ServiceUnavailableException(
      'Durable LGPD deletion scheduling is unavailable until the LGPD request ledger migration is deployed.',
    );
  }

  async cancelDeletion(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    this.validateDeletionInput(input);
    throw new ServiceUnavailableException(
      'Durable LGPD deletion cancellation is unavailable until the LGPD request ledger migration is deployed.',
    );
  }

  async hardDelete(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    this.validateDeletionInput(input);
    const anonymizedSubjectId = buildAnonymizedSubjectId(input.userId, input.requestId);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
      if (!user) {
        const anonymizedUser = await tx.user.findUnique({ where: { id: anonymizedSubjectId }, select: { id: true } });
        return {
          users: { count: 0 },
          pollImages: { count: 0 },
          relatedRecordsAnonymized: 0,
          alreadyAnonymized: Boolean(anonymizedUser),
        };
      }

      await tx.user.create({ data: { id: anonymizedSubjectId, roles: [], permissions: [], claims: Prisma.JsonNull } });
      const relatedRecordsAnonymized = await this.updateRelatedSubjectReferences(tx, input.userId, anonymizedSubjectId);
      const pollImages = await tx.pollImage.updateMany({
        where: { createdById: input.userId },
        data: { createdById: anonymizedSubjectId },
      });
      await tx.user.delete({ where: { id: input.userId } });
      return { users: { count: 1 }, pollImages, relatedRecordsAnonymized, alreadyAnonymized: false };
    });

    this.logger.log({ event: 'lgpd-deletion-completed', requestRef: this.requestReference(input.requestId) });

    return {
      success: result.users.count > 0 || result.alreadyAnonymized,
      usersAnonymized: result.users.count,
      relatedRecordsAnonymized: result.relatedRecordsAnonymized + result.pollImages.count,
      alreadyAnonymized: result.alreadyAnonymized,
      note: 'The requester identity is anonymized with a fixed-length subject/request HMAC across related voting, response, poll-management, and election-activity records. Voting records and results are preserved.',
    };
  }

  private async updateRelatedSubjectReferences(
    tx: Prisma.TransactionClient,
    userId: string,
    anonymizedSubjectId: string,
  ): Promise<number> {
    const [responses, voters, createdPolls, updatedPolls, eligibility, submittedSlates, createdSlates, reviewedSlates] = await Promise.all([
      tx.pollResponse.updateMany({ where: { userId }, data: { userId: anonymizedSubjectId } }),
      tx.pollVoter.updateMany({ where: { userId }, data: { userId: anonymizedSubjectId } }),
      tx.poll.updateMany({ where: { createdById: userId }, data: { createdById: anonymizedSubjectId } }),
      tx.poll.updateMany({ where: { updatedById: userId }, data: { updatedById: anonymizedSubjectId } }),
      tx.pollEligibilityEnrollment.updateMany({ where: { createdById: userId }, data: { createdById: anonymizedSubjectId } }),
      tx.cacicElectionSlate.updateMany({ where: { submittedById: userId }, data: { submittedById: anonymizedSubjectId } }),
      tx.cacicElectionSlate.updateMany({ where: { adminCreatedById: userId }, data: { adminCreatedById: anonymizedSubjectId } }),
      tx.cacicElectionSlate.updateMany({ where: { reviewedById: userId }, data: { reviewedById: anonymizedSubjectId } }),
    ]);
    return [responses, voters, createdPolls, updatedPolls, eligibility, submittedSlates, createdSlates, reviewedSlates]
      .reduce((total, current) => total + current.count, 0);
  }

  private validateDeletionInput(input: LgpdDeletionInput): void {
    if (!input.userId.trim() || input.userId.trim().length > 256 || !input.requestId.trim() || input.requestId.trim().length > 128) {
      throw new BadRequestException('A bounded user and request identifier are required.');
    }
  }

  private requestReference(requestId: string): string {
    return createHmac('sha256', process.env.LGPD_ANONYMIZATION_SECRET?.trim() || 'local-development-lgpd-anonymization-secret')
      .update(requestId)
      .digest('hex')
      .slice(0, 16);
  }
}

function buildAnonymizedSubjectId(userId: string, requestId: string): string {
  const secret = process.env.LGPD_ANONYMIZATION_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('LGPD_ANONYMIZATION_SECRET is required in production.');
  }
  const key = secret || 'local-development-lgpd-anonymization-secret';
  const message = `${userId.length}\0${userId}\0${requestId.length}\0${requestId}`;
  return `anonymized:${createHmac('sha256', key).update(message).digest('hex')}`;
}
