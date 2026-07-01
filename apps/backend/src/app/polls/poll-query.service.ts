import { Injectable, NotFoundException } from '@nestjs/common';
import { EventManagerEvent, Poll, PollSummary } from '@org/voting-contracts';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireAuthenticatedVoter } from './poll-auth';
import {
  toContractCacicElectionPhase,
  toContractLinkedEvent,
  toContractPoll,
  toContractPollMode,
  toContractStatus,
  toContractVoterEligibilitySource,
  toContractVotingStyle,
} from './poll-contract.mapper';
import { PollEligibilityService } from './poll-eligibility.service';
import { normalizeDirectLinkToken } from './poll-identifiers';
import { PollRecord, pollInclude } from './poll-records';
import { publicReadablePollWhere, shouldRequireVotingEligibilityForRead } from './poll-visibility';

@Injectable()
export class PollQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly eligibility: PollEligibilityService,
  ) {}

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.eventManager.listLinkableEvents();
  }

  async listAdminPolls(): Promise<PollSummary[]> {
    const polls = await this.prisma.poll.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: true,
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => this.toPollSummary(poll));
  }

  async listPublicPolls(): Promise<PollSummary[]> {
    const now = new Date();
    const polls = await this.prisma.poll.findMany({
      where: publicReadablePollWhere(now),
      orderBy: { publishedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: true,
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => this.toPollSummary(poll));
  }

  async getAdminPoll(id: string): Promise<Poll> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async getPublishedPoll(id: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...publicReadablePollWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = requireAuthenticatedVoter(user);
    if (shouldRequireVotingEligibilityForRead(poll)) {
      await this.eligibility.ensureVotingAllowed(poll, voter);
    }

    return toContractPoll(poll);
  }

  async getPublishedPollByDirectLink(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...publicReadablePollWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    requireAuthenticatedVoter(user);
    return toContractPoll(poll, { imageDirectLinkToken: normalizedToken });
  }

  async assertPublishedPollReadable(id: string, user?: AuthenticatedPrincipal): Promise<void> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...publicReadablePollWhere(now),
      },
      select: {
        id: true,
        mode: true,
        cacicElectionPhase: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = requireAuthenticatedVoter(user);
    if (shouldRequireVotingEligibilityForRead(poll)) {
      await this.eligibility.ensureVotingAllowed(poll, voter);
    }
  }

  async assertPublishedDirectLinkPollReadable(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<string> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...publicReadablePollWhere(now),
      },
      select: {
        id: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    requireAuthenticatedVoter(user);
    return poll.id;
  }

  private toPollSummary(
    poll: Omit<PollRecord, 'elements'> & {
      _count: {
        elements: number;
        responses: number;
      };
    },
  ): PollSummary {
    return {
      id: poll.id,
      title: poll.title,
      description: poll.description ?? undefined,
      status: toContractStatus(poll.status),
      mode: toContractPollMode(poll.mode),
      cacicElectionPhase: toContractCacicElectionPhase(poll.cacicElectionPhase),
      votingStyle: toContractVotingStyle(poll.votingStyle),
      voterEligibilitySource: toContractVoterEligibilitySource(poll.voterEligibilitySource),
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsLive,
      allowResponseEditing: poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEvent: toContractLinkedEvent(poll),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
      publishedAt: poll.publishedAt?.toISOString(),
      visibleFrom: poll.visibleFrom?.toISOString(),
      votingStartsAt: poll.votingStartsAt?.toISOString(),
      votingEndsAt: poll.votingEndsAt?.toISOString(),
      elementCount: poll._count.elements,
      responseCount: poll._count.responses,
    };
  }
}
