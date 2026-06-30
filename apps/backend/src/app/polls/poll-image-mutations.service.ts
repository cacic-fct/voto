import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavePollDto } from './dto/poll.dto';
import { PollMutationValidationService } from './poll-mutation-validation.service';

@Injectable()
export class PollImageMutationsService {
  constructor(private readonly validation: PollMutationValidationService) {}

  async reconcilePollImages(
    tx: Prisma.TransactionClient,
    pollId: string,
    input: SavePollDto,
  ): Promise<string[]> {
    const references = this.validation.collectImageReferences(input);
    const existingImages = await tx.pollImage.findMany({
      where: { pollId },
      select: {
        id: true,
        objectKey: true,
      },
    });
    const existingById = new Map(existingImages.map((image) => [image.id, image]));

    for (const reference of references) {
      if (!existingById.has(reference.id)) {
        throw new BadRequestException('Poll image reference is invalid.');
      }

      await tx.pollImage.update({
        where: {
          id: reference.id,
        },
        data: {
          placement: reference.placement,
          elementId: reference.elementId,
          position: reference.position,
          altText: reference.altText ?? null,
          caption: reference.caption ?? null,
        },
      });
    }

    const referencedIds = new Set(references.map((reference) => reference.id));
    const removedImages = existingImages.filter((image) => !referencedIds.has(image.id));
    if (removedImages.length > 0) {
      await tx.pollImage.deleteMany({
        where: {
          pollId,
          id: {
            in: removedImages.map((image) => image.id),
          },
        },
      });
    }

    return removedImages.map((image) => image.objectKey);
  }
}
