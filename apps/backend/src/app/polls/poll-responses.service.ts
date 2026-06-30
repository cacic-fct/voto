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
import {
  buildAnswerElementSnapshots,
  pollResponseInclude,
  toAnswerCreateData,
  toContractPollResponse,
} from './poll-response.mapper';
import { PollResultsService } from './poll-results.service';
import { validatePollResponse } from './poll-response.validator';

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
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        status: DbPollStatus.PUBLISHED,
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = requireAuthenticatedVoter(user);
    await this.eligibility.ensureVotingAllowed(poll, voter);
    const answers = validatePollResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.results.publishPollResultsForResponse(poll.id, response);

    return toContractPollResponse(response);
  }

  async submitDirectLinkResponse(
    directLinkToken: string,
    input: SubmitPollResponseDto,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResponse> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        status: DbPollStatus.PUBLISHED,
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = requireAuthenticatedVoter(user);
    const answers = validatePollResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.results.publishPollResultsForResponse(poll.id, response);

    return toContractPollResponse(response);
  }

  async getUserResponseState(id: string, user?: AuthenticatedPrincipal): Promise<PollUserResponseState> {
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      select: {
        id: true,
        status: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
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
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      select: {
        id: true,
        status: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
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
    const canSubmitAnother = poll.status === DbPollStatus.PUBLISHED && poll.allowMultipleResponses;
    const canEdit =
      poll.status === DbPollStatus.PUBLISHED &&
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
        const answerElementSnapshots = buildAnswerElementSnapshots(poll.elements);

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

          return this.createResponse(tx, poll.id, userId, answers, isAnonymous, answerElementSnapshots);
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
                create: answers.map((answer) => toAnswerCreateData(answer, answerElementSnapshots)),
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

        return this.createResponse(tx, poll.id, userId, answers, isAnonymous, answerElementSnapshots);
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
    answerElementSnapshots: Map<string, Prisma.InputJsonValue>,
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
            ...toAnswerCreateData(answer, answerElementSnapshots),
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
