import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PollImage } from '@org/voting-contracts';
import { PollStatus as DbPollStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import {
  UploadedPollImageFile,
  buildPollImageObjectKey,
  convertPollImageToAvif,
} from './poll-image.utils';

type PollImageRecord = {
  id: string;
  pollId: string;
  objectKey: string;
  mimeType: string;
  width: number;
  height: number;
  altText: string | null;
  caption: string | null;
};

@Injectable()
export class PollImagesService implements OnModuleInit, OnModuleDestroy {
  private stopping = false;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupRun?: Promise<void>;

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => this.startCleanup(), 60_000);
    this.cleanupTimer.unref();
    this.startCleanup();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.cleanupTimer);
    await this.cleanupRun;
  }

  private startCleanup(): void {
    if (this.stopping || this.cleanupRun) return;
    this.cleanupRun = this.retryPendingObjectDeletions()
      .catch(() => this.logger.warn('Poll image cleanup queue is unavailable; pending work is retained.'))
      .finally(() => { this.cleanupRun = undefined; });
  }

  async retryPendingObjectDeletions(): Promise<void> {
    await this.expireAbandonedStaging();
    const pending = await this.prisma.pollObjectDeletion.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 25,
    });
    for (const item of pending) {
      if (this.stopping) break;
      const claimed = await this.prisma.pollObjectDeletion.updateMany({
        where: { objectKey: item.objectKey, nextAttemptAt: item.nextAttemptAt },
        data: { nextAttemptAt: new Date(Date.now() + 120_000) },
      });
      if (claimed.count !== 1) continue;
      await this.deleteObjectBestEffort(item.objectKey);
    }
  }

  private async expireAbandonedStaging(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.pollImage.findMany({
        where: { placement: 'UNUSED', createdAt: { lt: cutoff } },
        orderBy: { createdAt: 'asc' }, take: 25,
        select: { id: true, objectKey: true },
      });
      for (const image of expired) {
        // Recheck placement in the DELETE so a concurrent save that attaches
        // the image wins rather than leaving an outbox intent for a live image.
        const removed = await tx.pollImage.deleteMany({
          where: { id: image.id, placement: 'UNUSED', createdAt: { lt: cutoff } },
        });
        if (removed.count === 1) {
          await tx.pollObjectDeletion.upsert({
            where: { objectKey: image.objectKey }, create: { objectKey: image.objectKey }, update: {},
          });
        }
      }
    });
  }

  private readonly logger = new Logger(PollImagesService.name);
  private readonly deleteAttempts = this.positiveInteger(process.env.S3_DELETE_RETRY_ATTEMPTS, 3);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async uploadPollImage(
    pollId: string,
    file: UploadedPollImageFile | undefined,
    user: AuthenticatedPrincipal,
  ): Promise<PollImage> {
    if (!user.sub) {
      throw new ForbiddenException('You cannot upload poll images.');
    }

    await this.assertPollExists(pollId);
    const imageId = randomUUID();
    const converted = await convertPollImageToAvif(file);
    const objectKey = buildPollImageObjectKey(pollId, imageId);
    // Persist compensation before S3 can succeed. Delay abandoned-upload cleanup
    // so a second instance cannot collect an upload while it is being attached.
    await this.prisma.pollObjectDeletion.create({
      data: { objectKey, nextAttemptAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    try {
      const uploadResult = await this.s3.uploadFile(
        objectKey,
        converted.buffer,
        'image/avif',
        { pollId, imageId, uploadedBy: user.sub, originalMimeType: converted.originalMimeType },
      );
      const image = await this.prisma.$transaction(async (tx) => {
        const created = await tx.pollImage.create({
          data: {
            id: imageId,
            pollId,
            objectKey: uploadResult.key,
            originalFileName: file?.originalname || 'imagem',
            originalMimeType: converted.originalMimeType,
            mimeType: 'image/avif',
            sizeBytes: uploadResult.size,
            width: converted.width,
            height: converted.height,
            createdById: user.sub,
          },
        });
        await tx.pollObjectDeletion.deleteMany({ where: { objectKey } });
        return created;
      });
      return this.toContractImage(image);
    } catch (error) {
      await this.deleteObjectBestEffort(objectKey);
      throw error;
    }
  }

  async deletePollImage(pollId: string, imageId: string): Promise<void> {
    const objectKey = await this.prisma.$transaction(async (tx) => {
      const image = await tx.pollImage.findFirst({
        where: { id: imageId, pollId }, select: { objectKey: true },
      });
      if (!image) throw new NotFoundException('Poll image not found.');
      await tx.pollObjectDeletion.upsert({
        where: { objectKey: image.objectKey },
        create: { objectKey: image.objectKey }, update: {},
      });
      await tx.pollImage.delete({ where: { id: imageId } });
      return image.objectKey;
    });
    await this.deleteObjectBestEffort(objectKey);
  }

  async getPollImage(
    pollId: string,
    imageId: string,
    user?: AuthenticatedPrincipal,
    options?: { allowPublishedRead?: boolean },
  ): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
  }> {
    const image = await this.prisma.pollImage.findFirst({
      where: {
        id: imageId,
        pollId,
      },
      select: {
        objectKey: true,
        mimeType: true,
        poll: {
          select: {
            status: true,
            resultsPublic: true,
            visibleFrom: true,
          },
        },
      },
    });

    if (!image) {
      throw new NotFoundException('Poll image not found.');
    }

    if (!this.canReadPollImage(image.poll, user, options?.allowPublishedRead === true)) {
      throw new ForbiddenException('You cannot access this poll image.');
    }

    const file = await this.s3.downloadFile(image.objectKey);
    return {
      stream: file.stream,
      contentType: file.contentType ?? image.mimeType,
      contentLength: file.contentLength,
    };
  }

  async deleteObjectKeysBestEffort(objectKeys: readonly string[]): Promise<void> {
    for (const objectKey of [...new Set(objectKeys)]) {
      await this.deleteObjectBestEffort(objectKey);
    }
  }

  toContractImage(image: PollImageRecord): PollImage {
    return {
      id: image.id,
      url: `/api/polls/${encodeURIComponent(image.pollId)}/images/${encodeURIComponent(image.id)}`,
      width: image.width,
      height: image.height,
      altText: image.altText ?? undefined,
      caption: image.caption ?? undefined,
    };
  }

  private async assertPollExists(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { id: true },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
  }

  private canReadPollImage(
    poll: { status: DbPollStatus; resultsPublic: boolean; visibleFrom: Date | null },
    user?: AuthenticatedPrincipal,
    allowPublishedRead = false,
  ): boolean {
    const isVisible = !poll.visibleFrom || poll.visibleFrom <= new Date();
    if (
      allowPublishedRead &&
      isVisible &&
      (poll.status === DbPollStatus.PUBLISHED || (poll.status === DbPollStatus.CLOSED && poll.resultsPublic))
    ) {
      return true;
    }

    return Boolean(user?.permissionSet.has('poll#read') || user?.permissions.includes('poll#read'));
  }

  private async deleteObjectBestEffort(objectKey: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.deleteAttempts; attempt += 1) {
      try {
        // A surviving reference always wins over a stale compensation intent.
        const referenced = await this.prisma.pollImage.findFirst({ where: { objectKey }, select: { id: true } });
        if (!referenced) await this.s3.deleteFile(objectKey);
        await this.prisma.pollObjectDeletion.deleteMany({ where: { objectKey } });
        return;
      } catch (error: unknown) {
        lastError = error;
        if (this.stopping) break;
        if (attempt < this.deleteAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        }
      }
    }

    try {
      await this.prisma.pollObjectDeletion.updateMany({
        where: { objectKey },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
      });
    } catch {
      // The existing durable intent remains eligible for the next worker/restart.
    }
    this.logger.warn(
      `Failed to delete poll image object ${objectKey} after ${this.deleteAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private positiveInteger(rawValue: string | undefined, fallback: number): number {
    const value = Number.parseInt(rawValue ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
