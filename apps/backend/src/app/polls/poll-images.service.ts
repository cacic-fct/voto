import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
export class PollImagesService {
  private readonly logger = new Logger(PollImagesService.name);

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
    const uploadResult = await this.s3.uploadFile(
      objectKey,
      converted.buffer,
      'image/avif',
      {
        pollId,
        imageId,
        uploadedBy: user.sub,
        originalMimeType: converted.originalMimeType,
      },
    );

    try {
      const image = await this.prisma.pollImage.create({
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

      return this.toContractImage(image);
    } catch (error) {
      await this.deleteObjectBestEffort(uploadResult.key);
      throw error;
    }
  }

  async deletePollImage(pollId: string, imageId: string): Promise<void> {
    const image = await this.prisma.pollImage.findFirst({
      where: {
        id: imageId,
        pollId,
      },
      select: {
        objectKey: true,
      },
    });

    if (!image) {
      throw new NotFoundException('Poll image not found.');
    }

    await this.prisma.pollImage.delete({
      where: {
        id: imageId,
      },
    });
    await this.deleteObjectBestEffort(image.objectKey);
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
    try {
      await this.s3.deleteFile(objectKey);
    } catch (error) {
      this.logger.warn(
        `Failed to delete poll image object ${objectKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
