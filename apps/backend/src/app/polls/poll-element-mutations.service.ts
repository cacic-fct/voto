import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavePollDto } from './dto/poll.dto';
import { cleanOptionalText, toDbElementType, toElementSnapshotJson } from './poll-contract.mapper';
import { PollMutationOptionsService } from './poll-mutation-options.service';

@Injectable()
export class PollElementMutationsService {
  constructor(private readonly options: PollMutationOptionsService) {}

  async syncElements(
    tx: Prisma.TransactionClient,
    pollId: string,
    elements: SavePollDto['elements'],
  ): Promise<void> {
    const existingElements = await tx.pollElement.findMany({
      where: { pollId },
      include: {
        options: {
          orderBy: { position: 'asc' },
        },
        _count: {
          select: {
            answers: true,
          },
        },
      },
    });
    const existingById = new Map(existingElements.map((element) => [element.id, element]));
    const inputElementIds = new Set(elements.map((element) => element.id));
    const now = new Date();

    for (const element of existingElements) {
      if (element.retiredAt || inputElementIds.has(element.id)) {
        continue;
      }

      if (element._count.answers > 0) {
        await tx.pollElement.update({
          where: { id: element.id },
          data: { retiredAt: now },
        });
        continue;
      }

      await tx.pollElement.delete({ where: { id: element.id } });
    }

    for (const [elementIndex, element] of elements.entries()) {
      const existing = existingById.get(element.id);
      const settings = this.options.normalizeElementSettings(element);
      const data = {
        pollId,
        type: toDbElementType(element.type),
        title: element.title.trim(),
        description: cleanOptionalText(element.description),
        required: element.required,
        settings: settings ? (settings as Prisma.InputJsonValue) : Prisma.JsonNull,
        position: elementIndex,
        retiredAt: null,
      };

      if (existing) {
        await tx.pollElement.update({
          where: { id: element.id },
          data,
        });
        await this.replaceElementOptions(tx, element.id, element.options);
        continue;
      }

      await tx.pollElement.create({
        data: {
          id: element.id,
          ...data,
          options: {
            create: element.options.map((option, optionIndex) => this.toElementOptionCreateData(option, optionIndex)),
          },
        },
      });
    }
  }

  async backfillAnswerElementSnapshots(tx: Prisma.TransactionClient, pollId: string): Promise<void> {
    const elements = await tx.pollElement.findMany({
      where: { pollId },
      include: {
        options: {
          orderBy: { position: 'asc' },
        },
      },
    });

    for (const element of elements) {
      await tx.pollAnswer.updateMany({
        where: {
          elementId: element.id,
          elementSnapshot: { equals: Prisma.DbNull },
        },
        data: {
          elementSnapshot: toElementSnapshotJson(element),
        },
      });
    }
  }

  private async replaceElementOptions(
    tx: Prisma.TransactionClient,
    elementId: string,
    options: SavePollDto['elements'][number]['options'],
  ): Promise<void> {
    await tx.pollElementOption.deleteMany({ where: { elementId } });
    if (options.length === 0) {
      return;
    }

    await tx.pollElementOption.createMany({
      data: options.map((option, optionIndex) => ({
        ...this.toElementOptionCreateData(option, optionIndex),
        elementId,
      })),
    });
  }

  private toElementOptionCreateData(
    option: SavePollDto['elements'][number]['options'][number],
    optionIndex: number,
  ): Prisma.PollElementOptionCreateWithoutElementInput {
    return {
      id: option.id,
      label: option.label.trim(),
      description: cleanOptionalText(option.description),
      position: optionIndex,
    };
  }
}
