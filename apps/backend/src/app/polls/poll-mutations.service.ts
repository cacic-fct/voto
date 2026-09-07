import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EventManagerEvent,
  Poll,
  PollElementSettings,
  PollStatus,
} from '@org/voting-contracts';
import {
  CacicElectionPhase as DbCacicElectionPhase,
  PollMode as DbPollMode,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { recordPollAdminAudit } from './poll-admin-audit';
import { SavePollDto } from './dto/poll.dto';
import { PollCacicElectionService } from './poll-cacic-election.service';
import { cleanOptionalText, toContractPoll, toDbStatus } from './poll-contract.mapper';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollImagesService } from './poll-images.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import { isSerializationConflictError } from './poll-auth';
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
    const poll = await this.runSerializableTransaction(async (tx) => {
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

      const saved = await tx.poll.findUniqueOrThrow({ where: { id: created.id }, include: pollInclude });
      await recordPollAdminAudit(tx, { pollId: created.id, actorId: user.sub, action: 'poll.created', afterVersion: saved.updatedAt });
      return saved;
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
    const existing = await this.prisma.poll.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            responses: true,
          },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const metadata = await this.resolvePollMetadata(input, existing);
    const resultVisibility = this.resolvePollResultVisibility(input, existing, metadata);
    const responseOptions = this.resolvePollResponseOptions(input, existing, metadata);
    const directLink = this.options.resolvePollDirectLink(input, existing, metadata);
    const publicationSchedule = this.resolvePollPublicationSchedule(input, existing);
    this.validatePollPublicationSchedule(publicationSchedule);
    this.assertPollPolicyTransition(existing, metadata, responseOptions, directLink);
    const removedImageObjectKeys: string[] = [];
    const poll = await this.runSerializableTransaction(async (tx) => {
      const current = await tx.poll.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              responses: true,
            },
          },
        },
      });
      if (!current || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException('Poll was changed by another administrator. Reload before saving.');
      }
      // Recheck the response count in the same serializable transaction. A vote
      // can be committed after the initial read without changing poll.updatedAt.
      this.assertPollPolicyTransition(current, metadata, responseOptions, directLink);
      await this.assertElectionTransitionReady(tx, id, current, metadata);
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

      const saved = await tx.poll.findUniqueOrThrow({ where: { id }, include: pollInclude });
      await recordPollAdminAudit(tx, { pollId: id, actorId: user.sub, action: 'poll.updated', beforeVersion: expectedUpdatedAt, afterVersion: saved.updatedAt });
      return saved;
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
      const saved = await tx.poll.findUniqueOrThrow({ where: { id }, include: pollInclude });
      await recordPollAdminAudit(tx, { pollId: id, actorId: user.sub, action: `poll.${status}`, beforeVersion: expectedVersion, afterVersion: saved.updatedAt });
      return saved;
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

  private assertPollPolicyTransition(
    existing: {
      status: DbPollStatus;
      mode: DbPollMode;
      cacicElectionPhase: DbCacicElectionPhase | null;
      votingStyle: DbPollVotingStyle;
      voterEligibilitySource: DbPollVoterEligibilitySource;
      requireVerifiedUnespRole: boolean;
      linkedEventId: string | null;
      directLinkEnabled: boolean;
      allowResponseEditing: boolean;
      allowMultipleResponses: boolean;
      _count?: { responses: number };
    },
    metadata: PollMetadataData,
    responseOptions: PollResponseOptionsData,
    directLink: { directLinkEnabled: boolean; directLinkToken: string | null },
  ): void {
    const hasPublishedOrCollectedBallots =
      existing.status !== DbPollStatus.DRAFT || (existing._count?.responses ?? 0) > 0;
    if (!hasPublishedOrCollectedBallots) {
      return;
    }

    if (existing.mode !== metadata.mode) {
      throw new ConflictException('A published poll cannot change its voting mode.');
    }

    const isSubmissionToElection =
      existing.mode === DbPollMode.CACIC_ELECTION &&
      existing.cacicElectionPhase === DbCacicElectionPhase.SLATE_SUBMISSION &&
      metadata.cacicElectionPhase === DbCacicElectionPhase.ELECTION &&
      (existing.status === DbPollStatus.DRAFT || existing.status === DbPollStatus.PUBLISHED) &&
      (existing._count?.responses ?? 0) === 0;
    if (existing.cacicElectionPhase !== metadata.cacicElectionPhase && !isSubmissionToElection) {
      throw new ConflictException('A published poll cannot change its election phase.');
    }

    if (isSubmissionToElection) {
      return;
    }

    if (
      existing.voterEligibilitySource !== metadata.voterEligibilitySource ||
      existing.requireVerifiedUnespRole !== metadata.requireVerifiedUnespRole ||
      existing.linkedEventId !== metadata.linkedEventId
    ) {
      throw new ConflictException('A published poll cannot change its voter eligibility policy.');
    }

    if ((existing._count?.responses ?? 0) > 0) {
      if (existing.votingStyle !== metadata.votingStyle) {
        throw new ConflictException('A poll with responses cannot change its voting privacy policy.');
      }
      if (
        existing.directLinkEnabled !== directLink.directLinkEnabled ||
        existing.allowResponseEditing !== responseOptions.allowResponseEditing ||
        existing.allowMultipleResponses !== responseOptions.allowMultipleResponses
      ) {
        throw new ConflictException('A poll with responses cannot change its response policy.');
      }
    }
  }

  private async assertElectionTransitionReady(
    tx: Prisma.TransactionClient,
    pollId: string,
    existing: {
      mode: DbPollMode;
      cacicElectionPhase: DbCacicElectionPhase | null;
    },
    metadata: PollMetadataData,
  ): Promise<void> {
    if (
      metadata.mode !== DbPollMode.CACIC_ELECTION ||
      metadata.cacicElectionPhase !== DbCacicElectionPhase.ELECTION ||
      (existing.mode === DbPollMode.CACIC_ELECTION && existing.cacicElectionPhase === DbCacicElectionPhase.ELECTION)
    ) {
      return;
    }

    const approvedSlate = await tx.cacicElectionSlate.findFirst({
      where: {
        pollId,
        status: 'APPROVED',
        enabled: true,
      },
      select: { id: true },
    });
    if (!approvedSlate) {
      throw new ConflictException('At least one approved and enabled slate is required before the election starts.');
    }

    const enrollment = await tx.pollEligibilityEnrollment.findFirst({
      where: { pollId },
      select: { enrollmentNumber: true },
    });
    if (!enrollment) {
      throw new ConflictException('At least one eligible enrollment is required before the election starts.');
    }
  }

  private async runSerializableTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (isSerializationConflictError(error)) {
        throw new ConflictException('The poll changed concurrently. Reload and retry.');
      }
      throw error;
    }
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

  async deletePoll(id: string, user?: AuthenticatedPrincipal): Promise<void> {
    const objectKeys = await this.runSerializableTransaction(async (tx) => {
      const poll = await tx.poll.findUnique({ where: { id }, select: { updatedAt: true } });
      if (!poll) return [];
      const images = await tx.pollImage.findMany({ where: { pollId: id }, select: { objectKey: true } });
      if (images.length) {
        await tx.pollObjectDeletion.createMany({ data: images, skipDuplicates: true });
      }
      await tx.poll.deleteMany({ where: { id } });
      await recordPollAdminAudit(tx, { pollId: id, actorId: user?.sub, action: 'poll.deleted', beforeVersion: poll.updatedAt });
      return images.map((image) => image.objectKey);
    });
    await this.pollImages.deleteObjectKeysBestEffort(objectKeys);
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
