import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavePollDto } from './dto/poll.dto';
import { cleanOptionalText, toDbElementType, toElementSnapshotJson } from './poll-contract.mapper';
import {
  assertDeterministicIdentifierAvailable,
  externalPollElementId,
  externalPollOptionId,
  namespacedPollElementId,
  namespacedPollOptionId,
} from './poll-identifiers';
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
    const existingByExternalId = new Map(
      existingElements.map((element) => [externalPollElementId(pollId, element.id), element]),
    );
    const inputElementIds = new Set(
      elements.flatMap((element) => [element.id, externalPollElementId(pollId, element.id)]),
    );
    const now = new Date();

    for (const element of existingElements) {
      if (
        element.retiredAt ||
        inputElementIds.has(element.id) ||
        inputElementIds.has(externalPollElementId(pollId, element.id))
      ) {
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
      const existing = existingById.get(element.id) ?? existingByExternalId.get(element.id);
      const storedElementId = existing?.id ?? (await this.resolveElementId(tx, pollId, element.id));
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
          where: { id: storedElementId },
          data,
        });
        await this.replaceElementOptions(tx, storedElementId, element.options);
        continue;
      }

      await tx.pollElement.create({
        data: {
          id: storedElementId,
          ...data,
          options: {
            create: await this.toElementOptionCreateDataList(tx, storedElementId, element.options),
          },
        },
      });
    }
  }

  async replaceElements(
    tx: Prisma.TransactionClient,
    pollId: string,
    elements: SavePollDto['elements'],
  ): Promise<void> {
    await tx.pollElement.deleteMany({ where: { pollId } });

    for (const [elementIndex, element] of elements.entries()) {
      const storedElementId = await this.resolveElementId(tx, pollId, element.id);
      const settings = this.options.normalizeElementSettings(element);
      await tx.pollElement.create({
        data: {
          id: storedElementId,
          pollId,
          type: toDbElementType(element.type),
          title: element.title.trim(),
          description: cleanOptionalText(element.description),
          required: element.required,
          settings: settings ? (settings as Prisma.InputJsonValue) : Prisma.JsonNull,
          position: elementIndex,
          options: {
            create: await this.toElementOptionCreateDataList(tx, storedElementId, element.options),
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
          elementSnapshot: toElementSnapshotJson(element, pollId),
        },
      });
    }
  }

  private async replaceElementOptions(
    tx: Prisma.TransactionClient,
    elementId: string,
    options: SavePollDto['elements'][number]['options'],
  ): Promise<void> {
    const existingOptions = await tx.pollElementOption.findMany({
      where: { elementId },
      select: { id: true },
    });
    const existingById = new Map(existingOptions.map((option) => [option.id, option.id]));
    const existingByExternalId = new Map(
      existingOptions.map((option) => [externalPollOptionId(elementId, option.id), option.id]),
    );
    await tx.pollElementOption.deleteMany({ where: { elementId } });
    if (options.length === 0) {
      return;
    }

    await tx.pollElementOption.createMany({
      data: await Promise.all(
        options.map(async (option, optionIndex) => ({
          ...this.toElementOptionCreateData(
            option,
            optionIndex,
            existingById.get(option.id) ??
              existingByExternalId.get(option.id) ??
              (await this.resolveOptionId(tx, elementId, option.id)),
          ),
          elementId,
        })),
      ),
    });
  }

  private async toElementOptionCreateDataList(
    tx: Prisma.TransactionClient,
    elementId: string,
    options: SavePollDto['elements'][number]['options'],
  ): Promise<Prisma.PollElementOptionCreateWithoutElementInput[]> {
    return Promise.all(
      options.map(async (option, optionIndex) =>
        this.toElementOptionCreateData(option, optionIndex, await this.resolveOptionId(tx, elementId, option.id)),
      ),
    );
  }

  private async resolveElementId(tx: Prisma.TransactionClient, pollId: string, externalId: string): Promise<string> {
    const namespacedId = namespacedPollElementId(pollId, externalId);
    const existing = await tx.pollElement.findUnique({
      where: { id: externalId },
      select: { id: true, pollId: true },
    });
    if (existing?.pollId === pollId) return externalId;
    const namespaced = await tx.pollElement.findUnique({
      where: { id: namespacedId },
      select: { id: true, pollId: true },
    });
    assertDeterministicIdentifierAvailable(
      namespaced ? { id: namespaced.id, parentId: namespaced.pollId } : null,
      pollId,
      'element identifier',
    );
    return namespacedId;
  }

  private async resolveOptionId(tx: Prisma.TransactionClient, elementId: string, externalId: string): Promise<string> {
    const namespacedId = namespacedPollOptionId(elementId, externalId);
    const existing = await tx.pollElementOption.findUnique({
      where: { id: externalId },
      select: { id: true, elementId: true },
    });
    if (existing?.elementId === elementId) return externalId;

    const namespaced = await tx.pollElementOption.findUnique({
      where: { id: namespacedId },
      select: { id: true, elementId: true },
    });
    assertDeterministicIdentifierAvailable(
      namespaced ? { id: namespaced.id, parentId: namespaced.elementId } : null,
      elementId,
      'option identifier',
    );
    return namespacedId;
  }

  private toElementOptionCreateData(
    option: SavePollDto['elements'][number]['options'][number],
    optionIndex: number,
    storedId = option.id,
  ): Prisma.PollElementOptionCreateWithoutElementInput {
    return {
      id: storedId,
      label: option.label.trim(),
      description: cleanOptionalText(option.description),
      position: optionIndex,
    };
  }
}
