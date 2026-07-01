import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PollResponse, PollResponseAnswer, PollUserResponseState } from '@org/voting-contracts';
import { PollStatus as DbPollStatus, PollVotingStyle as DbPollVotingStyle, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitPollResponseDto } from './dto/poll.dto';
import { isUniqueConstraintError, requireAuthenticatedVoter } from './poll-auth';
import { PollEligibilityService } from './poll-eligibility.service';
import { normalizeDirectLinkToken } from './poll-identifiers';
import {
  PollRecord,
  PollResultResponseRecord,
  PollUserResponseStateRecord,
  pollInclude,
} from './poll-records';
import { pollResponseInclude, toContractPollResponse } from './poll-response.mapper';
import { PollResultsService } from './poll-results.service';
import { validatePollResponse } from './poll-response.validator';
import {
  assertPollAcceptsVoteResponses,
  isPollVotingOpen,
  pollVotingOpenWhere,
  publicReadablePollWhere,
} from './poll-visibility';

@Injectable()
export class PollResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: PollEligibilityService,
    private readonly results: PollResultsService,
  ) {}

  async submitResponse(
    id: string,
    input: SubmitPollResponseDto,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResponse> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        status: DbPollStatus.PUBLISHED,
        ...pollVotingOpenWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    assertPollAcceptsVoteResponses(poll);
    const voter = requireAuthenticatedVoter(user);
    await this.eligibility.ensureVotingAllowed(poll, voter);
    const answers = validatePollResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.results.publishPollResultsForResponse(poll.id);

    return toContractPollResponse(response);
  }

  async submitDirectLinkResponse(
    directLinkToken: string,
    input: SubmitPollResponseDto,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResponse> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        status: DbPollStatus.PUBLISHED,
        ...pollVotingOpenWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    assertPollAcceptsVoteResponses(poll);
    const voter = requireAuthenticatedVoter(user);
    const answers = validatePollResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.results.publishPollResultsForResponse(poll.id);

    return toContractPollResponse(response);
  }

  async getUserResponseState(id: string, user?: AuthenticatedPrincipal): Promise<PollUserResponseState> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...publicReadablePollWhere(now),
      },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = requireAuthenticatedVoter(user);
    await this.eligibility.ensureVotingAllowed(poll, voter);
    return this.readUserResponseState(poll, voter);
  }

  async getDirectLinkUserResponseState(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollUserResponseState> {
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
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return this.readUserResponseState(poll, requireAuthenticatedVoter(user));
  }

  async readUserResponseState(
    poll: PollUserResponseStateRecord,
    voter: AuthenticatedVoter,
  ): Promise<PollUserResponseState> {
    const voterRecord = await this.prisma.pollVoter.findUnique({
      where: {
        pollId_userId: {
          pollId: poll.id,
          userId: voter.sub,
        },
      },
      select: {
        userId: true,
      },
    });
    const response =
      poll.votingStyle === DbPollVotingStyle.ANONYMOUS
        ? null
        : await this.findLatestUserResponse(poll.id, voter.sub);
    const hasSubmitted = Boolean(voterRecord ?? response);
    const acceptsResponses = isPollVotingOpen(poll, new Date());
    const canSubmitAnother = acceptsResponses && poll.allowMultipleResponses;
    const canEdit =
      acceptsResponses &&
      poll.votingStyle !== DbPollVotingStyle.ANONYMOUS &&
      poll.allowResponseEditing &&
      Boolean(response);

    return {
      hasSubmitted,
      canEdit,
      canSubmitAnother,
      ...(response ? { response: toContractPollResponse(response) } : {}),
    };
  }

  async saveResponse(
    poll: PollRecord,
    userId: string,
    answers: PollResponseAnswer[],
  ): Promise<PollResultResponseRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const isAnonymous = poll.votingStyle === DbPollVotingStyle.ANONYMOUS;

        if (poll.allowMultipleResponses) {
          await tx.pollVoter.upsert({
            where: {
              pollId_userId: {
                pollId: poll.id,
                userId,
              },
            },
            update: {},
            create: {
              pollId: poll.id,
              userId,
            },
          });

          return this.createResponse(tx, poll.id, userId, answers, isAnonymous);
        }

        const existingVoter = await tx.pollVoter.findUnique({
          where: {
            pollId_userId: {
              pollId: poll.id,
              userId,
            },
          },
          select: {
            userId: true,
          },
        });

        if (existingVoter) {
          if (!poll.allowResponseEditing || isAnonymous) {
            throw new ConflictException('User already voted in this poll.');
          }

          const existingResponse = await tx.pollResponse.findFirst({
            where: {
              pollId: poll.id,
              userId,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
            },
          });

          if (!existingResponse) {
            throw new ConflictException('User already voted in this poll.');
          }

          await tx.pollAnswer.deleteMany({
            where: {
              responseId: existingResponse.id,
            },
          });

          return tx.pollResponse.update({
            where: {
              id: existingResponse.id,
            },
            data: {
              submittedAt: new Date(),
              answers: {
                create: answers.map((answer) => ({
                  elementId: answer.elementId,
                  value: answer.value as Prisma.InputJsonValue,
                })),
              },
            },
            include: pollResponseInclude,
          });
        }

        await tx.pollVoter.create({
          data: {
            pollId: poll.id,
            userId,
          },
        });

        return this.createResponse(tx, poll.id, userId, answers, isAnonymous);
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (isUniqueConstraintError(error)) {
        throw new ConflictException('User already voted in this poll.');
      }

      throw error;
    }
  }

  createResponse(
    tx: Prisma.TransactionClient,
    pollId: string,
    userId: string,
    answers: PollResponseAnswer[],
    isAnonymous: boolean,
  ): Promise<PollResultResponseRecord> {
    return tx.pollResponse.create({
      data: {
        pollId,
        ...(isAnonymous
          ? {
              id: randomUUID(),
              userId: null,
              submittedAt: null,
            }
          : {
              userId,
            }),
        answers: {
          create: answers.map((answer) => ({
            ...(isAnonymous ? { id: randomUUID() } : {}),
            elementId: answer.elementId,
            value: answer.value as Prisma.InputJsonValue,
          })),
        },
      },
      include: pollResponseInclude,
    });
  }

  findLatestUserResponse(pollId: string, userId: string): Promise<PollResultResponseRecord | null> {
    return this.prisma.pollResponse.findFirst({
      where: {
        pollId,
        userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: pollResponseInclude,
    });
  }
}
