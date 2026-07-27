import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

    return {
      metadata: {
        source: 'cacic_voto',
        generatedAt: new Date().toISOString(),
        userId: input.userId,
        note: 'All records are selected by the requested Account Manager user ID. The supplied email is not used to find data.',
      },
      userProfile: user,
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
    };
  }

  async scheduleDeletion(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    this.logger.log(`Scheduled LGPD deletion request=${input.requestId}, user=${input.userId}.`);

    return {
      success: true,
      deferredToHardDeletion: true,
      note: 'CACiC Voto keeps no independent soft-delete state. Account Manager disables the account before this call; hard deletion removes the requester identity and its direct voting link.',
    };
  }

  async cancelDeletion(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    this.logger.log(`Cancelled LGPD deletion request=${input.requestId}, user=${input.userId}.`);

    return { success: true, restoredRecords: 0 };
  }

  async hardDelete(input: LgpdDeletionInput): Promise<Record<string, unknown>> {
    const deletedUser = await this.prisma.user.deleteMany({ where: { id: input.userId } });

    this.logger.log(`Hard-deleted CACiC Voto LGPD data request=${input.requestId}, user=${input.userId}.`);

    return {
      success: true,
      usersDeleted: deletedUser.count,
      note: 'Deleting the requester user removes direct identity fields, voter registrations, and user links on responses and election activities. Poll content and other users remain untouched.',
    };
  }
}
