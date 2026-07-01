import { Injectable } from '@nestjs/common';
import {
  CACIC_ELECTION_BLANK_OPTION_ID,
  CACIC_ELECTION_NULL_OPTION_ID,
  CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
  CACIC_ELECTION_VOTE_ELEMENT_ID,
} from '@org/voting-contracts';
import {
  CacicElectionPhase as DbCacicElectionPhase,
  CacicElectionSlateStatus as DbCacicElectionSlateStatus,
  PollMode as DbPollMode,
  Prisma,
} from '@prisma/client';
import { SavePollDto } from './dto/poll.dto';
import { cacicElectionSlateOptionId } from './poll-cacic-election.mapper';
import { cleanOptionalText, toDbElementType } from './poll-contract.mapper';

type CacicElectionElementMetadata = {
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
};

@Injectable()
export class PollCacicElectionElementsService {
  async resolvePollElementsForSave(
    tx: Prisma.TransactionClient,
    pollId: string,
    input: SavePollDto,
    metadata: CacicElectionElementMetadata,
  ): Promise<SavePollDto['elements']> {
    if (metadata.mode !== DbPollMode.CACIC_ELECTION) {
      return input.elements;
    }

    return this.resolveCacicElectionElements(tx, pollId, input.elements, metadata.cacicElectionPhase);
  }

  async refreshCacicElectionVoteElement(tx: Prisma.TransactionClient, pollId: string): Promise<void> {
    const poll = await tx.poll.findUnique({
      where: { id: pollId },
      select: {
        mode: true,
        cacicElectionPhase: true,
      },
    });

    if (!poll || poll.mode !== DbPollMode.CACIC_ELECTION || poll.cacicElectionPhase !== DbCacicElectionPhase.ELECTION) {
      return;
    }

    await this.upsertCacicElectionVoteElement(tx, pollId, await this.buildCacicElectionVoteElement(tx, pollId));
  }

  private async resolveCacicElectionElements(
    tx: Prisma.TransactionClient,
    pollId: string,
    elements: SavePollDto['elements'],
    phase: DbCacicElectionPhase | null,
  ): Promise<SavePollDto['elements']> {
    const generatedElement =
      phase === DbCacicElectionPhase.ELECTION
        ? await this.buildCacicElectionVoteElement(tx, pollId)
        : this.buildCacicElectionSlateFormElement();
    const generatedIds = new Set([CACIC_ELECTION_SLATE_FORM_ELEMENT_ID, CACIC_ELECTION_VOTE_ELEMENT_ID]);
    const resolvedElements: SavePollDto['elements'] = [];
    let insertedGeneratedElement = false;

    for (const element of elements) {
      if (!generatedIds.has(element.id)) {
        resolvedElements.push(element);
        continue;
      }

      if (!insertedGeneratedElement && element.id === generatedElement.id) {
        resolvedElements.push(generatedElement);
        insertedGeneratedElement = true;
      }
    }

    return insertedGeneratedElement ? resolvedElements : [generatedElement, ...resolvedElements];
  }

  private buildCacicElectionSlateFormElement(): SavePollDto['elements'][number] {
    return {
      id: CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
      type: 'statement',
      title: 'Formulário de submissão de chapas',
      description:
        'Campo gerado com nome da chapa, integrantes, matrícula, cargo, identificação, representante e termos obrigatórios.',
      required: false,
      options: [],
    };
  }

  private async buildCacicElectionVoteElement(
    tx: Prisma.TransactionClient,
    pollId: string,
  ): Promise<SavePollDto['elements'][number]> {
    const slates = await tx.cacicElectionSlate.findMany({
      where: {
        pollId,
        status: DbCacicElectionSlateStatus.APPROVED,
        enabled: true,
      },
      orderBy: [{ name: 'asc' }, { submittedAt: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    return {
      id: CACIC_ELECTION_VOTE_ELEMENT_ID,
      type: 'singleChoice',
      title: 'Escolha a chapa',
      description: 'Selecione uma chapa aprovada ou registre voto em branco ou nulo.',
      required: true,
      options: [
        ...slates.map((slate) => ({
          id: cacicElectionSlateOptionId(slate.id),
          label: slate.name,
        })),
        {
          id: CACIC_ELECTION_BLANK_OPTION_ID,
          label: 'Branco',
          description: 'Registrar voto em branco.',
        },
        {
          id: CACIC_ELECTION_NULL_OPTION_ID,
          label: 'Nulo',
          description: 'Registrar voto nulo.',
        },
      ],
    };
  }

  private async upsertCacicElectionVoteElement(
    tx: Prisma.TransactionClient,
    pollId: string,
    element: SavePollDto['elements'][number],
  ): Promise<void> {
    const options = element.options.map((option, optionIndex) => ({
      id: option.id,
      label: option.label.trim(),
      description: cleanOptionalText(option.description),
      position: optionIndex,
    }));
    const existingElement = await tx.pollElement.findFirst({
      where: {
        id: element.id,
        pollId,
      },
      select: {
        id: true,
      },
    });

    if (existingElement) {
      await tx.pollElement.update({
        where: { id: existingElement.id },
        data: {
          type: toDbElementType(element.type),
          title: element.title.trim(),
          description: cleanOptionalText(element.description),
          required: element.required,
          settings: Prisma.JsonNull,
          options: {
            deleteMany: {},
            create: options,
          },
        },
      });
      return;
    }

    const lastElement = await tx.pollElement.findFirst({
      where: { pollId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await tx.pollElement.create({
      data: {
        id: element.id,
        pollId,
        type: toDbElementType(element.type),
        title: element.title.trim(),
        description: cleanOptionalText(element.description),
        required: element.required,
        position: (lastElement?.position ?? -1) + 1,
        options: {
          create: options,
        },
      },
    });
  }
}
