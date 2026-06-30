import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  EventManagerEvent,
  Poll,
  PollElementSettings,
  PollStatus,
} from '@org/voting-contracts';
import {
  PollStatus as DbPollStatus,
  PollVotingStyle as DbPollVotingStyle,
} from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavePollDto } from './dto/poll.dto';
import { cleanOptionalText, toContractPoll, toDbStatus } from './poll-contract.mapper';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollImagesService } from './poll-images.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import {
  PollMetadataData,
  PollResponseOptionsData,
  PollResultVisibilityData,
  pollInclude,
} from './poll-records';

@Injectable()
export class PollMutationsService {
  private readonly validation: PollMutationValidationService;
  private readonly options: PollMutationOptionsService;
  private readonly elementMutations: PollElementMutationsService;
  private readonly imageMutations: PollImageMutationsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly pollImages?: PollImagesService,
    @Optional()
    pollValidation?: PollMutationValidationService,
    @Optional()
    pollOptions?: PollMutationOptionsService,
    @Optional()
    pollElementMutations?: PollElementMutationsService,
    @Optional()
    pollImageMutations?: PollImageMutationsService,
  ) {
    this.validation = pollValidation ?? new PollMutationValidationService();
    this.options = pollOptions ?? new PollMutationOptionsService(eventManager);
    this.elementMutations = pollElementMutations ?? new PollElementMutationsService(this.options);
    this.imageMutations = pollImageMutations ?? new PollImageMutationsService(this.validation);
  }

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.eventManager.listLinkableEvents();
  }

  async createPoll(input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    const metadata = await this.resolvePollMetadata(input);
    const resultVisibility = this.resolvePollResultVisibility(input);
    const responseOptions = this.resolvePollResponseOptions(input, undefined, metadata.votingStyle);
    const directLink = this.options.resolvePollDirectLink(input);
    const status = toDbStatus(input.status ?? 'draft');
    const now = new Date();

    const removedImageObjectKeys: string[] = [];
    const poll = await this.prisma.$transaction(async (tx) => {
      const created = await tx.poll.create({
        data: {
          title: input.title.trim(),
          description: cleanOptionalText(input.description),
          status,
          ...metadata,
          ...resultVisibility,
          ...responseOptions,
          ...directLink,
          publishedAt: status === DbPollStatus.PUBLISHED ? now : undefined,
          closedAt: status === DbPollStatus.CLOSED ? now : undefined,
          createdById: user.sub,
          updatedById: user.sub,
        },
      });

      await this.elementMutations.syncElements(tx, created.id, input.elements);
      removedImageObjectKeys.push(...(await this.imageMutations.reconcilePollImages(tx, created.id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id: created.id },
        include: pollInclude,
      });
    });

    await this.pollImages?.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePoll(id: string, input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const status = toDbStatus(input.status ?? this.toContractStatusForExisting(existing.status));
    const metadata = await this.resolvePollMetadata(input, existing);
    const resultVisibility = this.resolvePollResultVisibility(input, existing);
    const responseOptions = this.resolvePollResponseOptions(input, existing, metadata.votingStyle);
    const directLink = this.options.resolvePollDirectLink(input, existing);
    const now = new Date();

    const removedImageObjectKeys: string[] = [];
    const poll = await this.prisma.$transaction(async (tx) => {
      await tx.poll.update({
        where: { id },
        data: {
          title: input.title.trim(),
          description: cleanOptionalText(input.description),
          status,
          ...metadata,
          ...resultVisibility,
          ...responseOptions,
          ...directLink,
          publishedAt: status === DbPollStatus.PUBLISHED ? existing.publishedAt ?? now : existing.publishedAt,
          closedAt: status === DbPollStatus.CLOSED ? existing.closedAt ?? now : null,
          updatedById: user.sub,
        },
      });

      await this.elementMutations.backfillAnswerElementSnapshots(tx, id);
      await this.elementMutations.syncElements(tx, id, input.elements);
      removedImageObjectKeys.push(...(await this.imageMutations.reconcilePollImages(tx, id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id },
        include: pollInclude,
      });
    });

    await this.pollImages?.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePollStatus(id: string, status: PollStatus, user: AuthenticatedPrincipal): Promise<Poll> {
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const dbStatus = toDbStatus(status);
    const now = new Date();
    const poll = await this.prisma.poll.update({
      where: { id },
      data: {
        status: dbStatus,
        publishedAt: dbStatus === DbPollStatus.PUBLISHED ? existing.publishedAt ?? now : existing.publishedAt,
        closedAt: dbStatus === DbPollStatus.CLOSED ? existing.closedAt ?? now : null,
        updatedById: user.sub,
      },
      include: pollInclude,
    });

    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async deletePoll(id: string): Promise<void> {
    const images = await this.prisma.pollImage.findMany({
      where: { pollId: id },
      select: { objectKey: true },
    });
    await this.prisma.poll.deleteMany({ where: { id } });
    await this.pollImages?.deleteObjectKeysBestEffort(images.map((image) => image.objectKey));
  }

  validatePollInput(input: SavePollDto): void {
    return this.validation.validatePollInput(input);
  }

  normalizeElementSettings(element: SavePollDto['elements'][number]): PollElementSettings | undefined {
    return this.options.normalizeElementSettings(element);
  }

  resolvePollMetadata(input: SavePollDto, existing?: PollMetadataData): Promise<PollMetadataData> {
    return this.options.resolvePollMetadata(input, existing);
  }

  resolvePollResultVisibility(input: SavePollDto, existing?: PollResultVisibilityData): PollResultVisibilityData {
    return this.options.resolvePollResultVisibility(input, existing);
  }

  resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    votingStyle: DbPollVotingStyle,
  ): PollResponseOptionsData {
    return this.options.resolvePollResponseOptions(input, existing, votingStyle);
  }

  private toContractStatusForExisting(status: DbPollStatus): PollStatus {
    switch (status) {
      case DbPollStatus.DRAFT:
        return 'draft';
      case DbPollStatus.PUBLISHED:
        return 'published';
      case DbPollStatus.CLOSED:
        return 'closed';
    }
  }
}
