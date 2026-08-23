import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EventManagerEvent,
  Poll,
  PollElementSettings,
  PollStatus,
} from '@org/voting-contracts';
import { PollStatus as DbPollStatus, Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavePollDto } from './dto/poll.dto';
import { PollCacicElectionService } from './poll-cacic-election.service';
import { cleanOptionalText, toContractPoll, toDbStatus } from './poll-contract.mapper';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollImagesService } from './poll-images.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import {
  PollMetadataData,
  PollPublicationScheduleData,
  PollResponseOptionsData,
  PollResultVisibilityData,
  pollInclude,
} from './poll-records';

@Injectable()
export class PollMutationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly cacicElection: PollCacicElectionService,
    private readonly pollImages: PollImagesService,
    private readonly validation: PollMutationValidationService,
    private readonly options: PollMutationOptionsService,
    private readonly elementMutations: PollElementMutationsService,
    private readonly imageMutations: PollImageMutationsService,
  ) {}

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.eventManager.listLinkableEvents();
  }

  async createPoll(input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    if (this.readSubmittedStatus(input) !== undefined) {
      throw new ConflictException('Poll status changes must use the publish endpoint.');
    }
    const metadata = await this.resolvePollMetadata(input);
    const resultVisibility = this.resolvePollResultVisibility(input, undefined, metadata);
    const responseOptions = this.resolvePollResponseOptions(input, undefined, metadata);
    const directLink = this.options.resolvePollDirectLink(input, undefined, metadata);
    const publicationSchedule = this.resolvePollPublicationSchedule(input, undefined);
    this.validatePollPublicationSchedule(publicationSchedule);
    const status = DbPollStatus.DRAFT;

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
          ...publicationSchedule,
          publishedAt: null,
          closedAt: null,
          createdById: user.sub,
          updatedById: user.sub,
        },
      });

      await this.elementMutations.syncElements(
        tx,
        created.id,
        await this.cacicElection.resolvePollElementsForSave(tx, created.id, input, metadata),
      );
      removedImageObjectKeys.push(...(await this.imageMutations.reconcilePollImages(tx, created.id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id: created.id },
        include: pollInclude,
      });
    });

    await this.pollImages.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePoll(id: string, input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    if (this.readSubmittedStatus(input) !== undefined) {
      throw new ConflictException('Poll status changes must use the publish endpoint.');
    }
    const expectedUpdatedAt = this.parseExpectedUpdatedAt(input.expectedUpdatedAt);
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const metadata = await this.resolvePollMetadata(input, existing);
    const resultVisibility = this.resolvePollResultVisibility(input, existing, metadata);
    const responseOptions = this.resolvePollResponseOptions(input, existing, metadata);
    const directLink = this.options.resolvePollDirectLink(input, existing, metadata);
    const publicationSchedule = this.resolvePollPublicationSchedule(input, existing);
    this.validatePollPublicationSchedule(publicationSchedule);
    const removedImageObjectKeys: string[] = [];
    const poll = await this.prisma.$transaction(async (tx) => {
      const updated = await this.updatePollWithVersion(tx, id, expectedUpdatedAt, {
        title: input.title.trim(),
        description: cleanOptionalText(input.description),
        status: existing.status,
        ...metadata,
        ...resultVisibility,
        ...responseOptions,
        ...directLink,
        ...publicationSchedule,
        publishedAt: existing.publishedAt,
        closedAt: existing.closedAt,
        updatedById: user.sub,
      });
      if (!updated) {
        throw new ConflictException('Poll was changed by another administrator. Reload before saving.');
      }

      await this.elementMutations.backfillAnswerElementSnapshots(tx, id);
      await this.elementMutations.syncElements(
        tx,
        id,
        await this.cacicElection.resolvePollElementsForSave(tx, id, input, metadata),
      );
      removedImageObjectKeys.push(...(await this.imageMutations.reconcilePollImages(tx, id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id },
        include: pollInclude,
      });
    });

    await this.pollImages.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePollStatus(
    id: string,
    status: PollStatus,
    user: AuthenticatedPrincipal,
    expectedUpdatedAt?: string,
  ): Promise<Poll> {
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const dbStatus = toDbStatus(status);
    this.assertValidStatusTransition(existing.status, dbStatus);
    const expectedVersion = this.parseExpectedUpdatedAt(expectedUpdatedAt);
    const now = new Date();
    const poll = await this.prisma.$transaction(async (tx) => {
      const updated = await this.updatePollWithVersion(tx, id, expectedVersion, {
        status: dbStatus,
        publishedAt: dbStatus === DbPollStatus.PUBLISHED ? existing.publishedAt ?? now : existing.publishedAt,
        closedAt: dbStatus === DbPollStatus.CLOSED ? now : null,
        updatedById: user.sub,
      });
      if (!updated) {
        throw new ConflictException('Poll was changed by another administrator. Reload before updating status.');
      }
      return tx.poll.findUniqueOrThrow({ where: { id }, include: pollInclude });
    });

    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  private parseExpectedUpdatedAt(value: string | undefined): Date {
    if (!value) {
      throw new ConflictException('A current poll version is required for this mutation.');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ConflictException('The poll version is invalid. Reload before retrying.');
    }
    return date;
  }

  private assertValidStatusTransition(current: DbPollStatus, next: DbPollStatus): void {
    const allowed =
      (current === DbPollStatus.DRAFT && next === DbPollStatus.PUBLISHED) ||
      (current === DbPollStatus.PUBLISHED && next === DbPollStatus.CLOSED) ||
      (current === DbPollStatus.CLOSED && next === DbPollStatus.PUBLISHED);
    if (!allowed) {
      throw new ConflictException(`Poll cannot transition from ${current.toLowerCase()} to ${next.toLowerCase()}.`);
    }
  }

  private async updatePollWithVersion(
    tx: Prisma.TransactionClient,
    id: string,
    expectedUpdatedAt: Date,
    data: Prisma.PollUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const result = await tx.poll.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data,
    });
    return result.count === 1;
  }

  private readSubmittedStatus(input: SavePollDto): PollStatus | undefined {
    const value = (input as SavePollDto & { status?: unknown }).status;
    return typeof value === 'string' ? (value as PollStatus) : undefined;
  }

  async deletePoll(id: string): Promise<void> {
    const images = await this.prisma.pollImage.findMany({
      where: { pollId: id },
      select: { objectKey: true },
    });
    await this.prisma.poll.deleteMany({ where: { id } });
    await this.pollImages.deleteObjectKeysBestEffort(images.map((image) => image.objectKey));
  }

  validatePollInput(input: SavePollDto): void {
    return this.validation.validatePollInput(input);
  }

  validatePollPublicationSchedule(schedule: PollPublicationScheduleData): void {
    return this.validation.validatePollPublicationSchedule(schedule);
  }

  normalizeElementSettings(element: SavePollDto['elements'][number]): PollElementSettings | undefined {
    return this.options.normalizeElementSettings(element);
  }

  resolvePollMetadata(input: SavePollDto, existing?: PollMetadataData): Promise<PollMetadataData> {
    return this.options.resolvePollMetadata(input, existing);
  }

  resolvePollResultVisibility(
    input: SavePollDto,
    existing?: PollResultVisibilityData,
    metadata?: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase'>,
  ): PollResultVisibilityData {
    return this.options.resolvePollResultVisibility(input, existing, metadata);
  }

  resolvePollPublicationSchedule(
    input: SavePollDto,
    existing?: PollPublicationScheduleData,
  ): PollPublicationScheduleData {
    return this.options.resolvePollPublicationSchedule(input, existing);
  }

  resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    metadata: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase' | 'votingStyle'>,
  ): PollResponseOptionsData {
    return this.options.resolvePollResponseOptions(input, existing, metadata);
  }
}
