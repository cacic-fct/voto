import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EventManagerEvent,
  PollChoiceOption,
  PollElementSettings,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import {
  CacicElectionPhase as DbCacicElectionPhase,
  PollMode as DbPollMode,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
} from '@prisma/client';
import { setMilliseconds, setSeconds } from 'date-fns';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { SavePollDto } from './dto/poll.dto';
import {
  cleanOptionalText,
  isComputerScienceEligibilitySource,
  isEventAttendanceEligibilitySource,
  isGridElement,
  parseEventDate,
  toDbCacicElectionPhase,
  toDbPollMode,
  toDbVoterEligibilitySource,
  toDbVotingStyle,
} from './poll-contract.mapper';
import { createUuidV7 } from './poll-identifiers';
import {
  PollDirectLinkData,
  PollMetadataData,
  PollPublicationScheduleData,
  PollResponseOptionsData,
  PollResultVisibilityData,
} from './poll-records';

@Injectable()
export class PollMutationOptionsService {
  constructor(private readonly eventManager: EventManagerIntegrationService) {}

  async resolvePollMetadata(input: SavePollDto, existing?: PollMetadataData): Promise<PollMetadataData> {
    const mode = toDbPollMode(input.mode ?? 'regular');
    const cacicElectionPhase =
      mode === DbPollMode.CACIC_ELECTION
        ? toDbCacicElectionPhase(input.cacicElectionPhase ?? 'slateSubmission')
        : null;

    if (mode === DbPollMode.CACIC_ELECTION && cacicElectionPhase === DbCacicElectionPhase.ELECTION) {
      return {
        mode,
        cacicElectionPhase,
        votingStyle: DbPollVotingStyle.ANONYMOUS,
        voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST,
        requireVerifiedUnespRole: false,
        linkedEventId: null,
        linkedEventName: null,
        linkedEventStartDate: null,
        linkedEventEndDate: null,
        linkedEventLocationDescription: null,
      };
    }

    const votingStyle = toDbVotingStyle(input.votingStyle ?? 'secret');
    const voterEligibilitySource = toDbVoterEligibilitySource(input.voterEligibilitySource ?? 'authenticatedUsers');
    const requireVerifiedUnespRole =
      input.requireVerifiedUnespRole === true && isComputerScienceEligibilitySource(voterEligibilitySource);
    const linkedEventId = cleanOptionalText(input.linkedEventId) ?? null;

    if (!linkedEventId) {
      if (isEventAttendanceEligibilitySource(voterEligibilitySource)) {
        throw new BadRequestException('A linked event is required when voting eligibility comes from attendance.');
      }

      return {
        mode,
        cacicElectionPhase,
        votingStyle,
        voterEligibilitySource,
        requireVerifiedUnespRole,
        linkedEventId: null,
        linkedEventName: null,
        linkedEventStartDate: null,
        linkedEventEndDate: null,
        linkedEventLocationDescription: null,
      };
    }

    if (
      existing?.linkedEventId === linkedEventId &&
      existing.linkedEventName &&
      existing.linkedEventStartDate &&
      existing.linkedEventEndDate
    ) {
      return {
        mode,
        cacicElectionPhase,
        votingStyle,
        voterEligibilitySource,
        requireVerifiedUnespRole,
        linkedEventId: existing.linkedEventId,
        linkedEventName: existing.linkedEventName,
        linkedEventStartDate: existing.linkedEventStartDate,
        linkedEventEndDate: existing.linkedEventEndDate,
        linkedEventLocationDescription: existing.linkedEventLocationDescription,
      };
    }

    const event = (await this.eventManager.listLinkableEvents()).find((item) => item.id === linkedEventId);
    if (!event) {
      throw new BadRequestException('Linked event was not found or is not available for new poll links.');
    }

    return this.toPollMetadataFromEvent(
      event,
      mode,
      cacicElectionPhase,
      votingStyle,
      voterEligibilitySource,
      requireVerifiedUnespRole,
    );
  }

  resolvePollResultVisibility(
    input: SavePollDto,
    existing?: PollResultVisibilityData,
    metadata?: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase'>,
  ): PollResultVisibilityData {
    if (metadata?.mode === DbPollMode.CACIC_ELECTION) {
      return {
        resultsPublic: metadata.cacicElectionPhase === DbCacicElectionPhase.ELECTION,
        resultsLive: false,
      };
    }

    const resultsPublic = input.resultsPublic ?? existing?.resultsPublic ?? false;
    return {
      resultsPublic,
      resultsLive: resultsPublic && (input.resultsLive ?? existing?.resultsLive ?? false),
    };
  }

  resolvePollPublicationSchedule(
    input: SavePollDto,
    existing?: PollPublicationScheduleData,
  ): PollPublicationScheduleData {
    return {
      visibleFrom:
        input.visibleFrom === undefined ? existing?.visibleFrom ?? null : this.normalizeScheduleDate(input.visibleFrom),
      votingStartsAt:
        input.votingStartsAt === undefined
          ? existing?.votingStartsAt ?? null
          : this.normalizeScheduleDate(input.votingStartsAt),
      votingEndsAt:
        input.votingEndsAt === undefined ? existing?.votingEndsAt ?? null : this.normalizeScheduleDate(input.votingEndsAt),
    };
  }

  resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    metadata: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase' | 'votingStyle'>,
  ): PollResponseOptionsData {
    if (metadata.mode === DbPollMode.CACIC_ELECTION && metadata.cacicElectionPhase === DbCacicElectionPhase.ELECTION) {
      return {
        allowResponseEditing: false,
        allowMultipleResponses: false,
      };
    }

    const allowMultipleResponses = input.allowMultipleResponses ?? existing?.allowMultipleResponses ?? false;
    const allowResponseEditing =
      metadata.votingStyle !== DbPollVotingStyle.ANONYMOUS &&
      !allowMultipleResponses &&
      (input.allowResponseEditing ?? existing?.allowResponseEditing ?? false);

    return {
      allowResponseEditing,
      allowMultipleResponses,
    };
  }

  resolvePollDirectLink(
    input: SavePollDto,
    existing?: PollDirectLinkData,
    metadata?: Pick<PollMetadataData, 'mode'>,
  ): PollDirectLinkData {
    if (metadata?.mode === DbPollMode.CACIC_ELECTION) {
      return {
        directLinkEnabled: false,
        directLinkToken: existing?.directLinkToken ?? null,
      };
    }

    const directLinkEnabled = input.directLinkEnabled ?? existing?.directLinkEnabled ?? false;
    const directLinkToken = directLinkEnabled
      ? existing?.directLinkToken ?? createUuidV7()
      : existing?.directLinkToken ?? null;

    return {
      directLinkEnabled,
      directLinkToken,
    };
  }

  normalizeElementSettings(element: SavePollDto['elements'][number]): PollElementSettings | undefined {
    if (isGridElement(element.type) && element.settings?.grid) {
      return {
        grid: {
          rows: this.normalizeSettingsOptions(element.settings.grid.rows),
          columns: this.normalizeSettingsOptions(element.settings.grid.columns),
        },
      };
    }

    if (element.type === 'linearScale' && element.settings?.linearScale) {
      const minLabel = cleanOptionalText(element.settings.linearScale.minLabel);
      const maxLabel = cleanOptionalText(element.settings.linearScale.maxLabel);

      return {
        linearScale: {
          min: element.settings.linearScale.min,
          max: element.settings.linearScale.max,
          ...(minLabel ? { minLabel } : {}),
          ...(maxLabel ? { maxLabel } : {}),
        },
      };
    }

    if (element.type === 'starRating' && element.settings?.starRating) {
      return {
        starRating: {
          max: element.settings.starRating.max,
        },
      };
    }

    if (element.type === 'scheduling' && element.settings?.scheduling) {
      return {
        scheduling: this.normalizeSchedulingSettings(element.settings.scheduling),
      };
    }

    return undefined;
  }

  normalizeSchedulingSettings(settings: PollSchedulingSettings): PollSchedulingSettings {
    const hostName = cleanOptionalText(settings.hostName);
    const location = cleanOptionalText(settings.location);
    const inviteeMode = settings.inviteeMode;

    return {
      ...(hostName ? { hostName } : {}),
      ...(location ? { location } : {}),
      timezone: settings.timezone.trim(),
      durationMinutes: settings.durationMinutes,
      slotIntervalMinutes: settings.slotIntervalMinutes,
      bufferBeforeMinutes: settings.bufferBeforeMinutes,
      bufferAfterMinutes: settings.bufferAfterMinutes,
      inviteeMode,
      maxInvitees: inviteeMode === 'none' ? 0 : settings.maxInvitees,
      availability: settings.availability.map((availability) => ({
        id: availability.id.trim(),
        date: availability.date.trim(),
        startTime: availability.startTime.trim(),
        endTime: availability.endTime.trim(),
      })),
    };
  }

  normalizeSettingsOptions(options: readonly PollChoiceOption[]): PollChoiceOption[] {
    return options.map((option) => {
      const description = cleanOptionalText(option.description);
      return {
        id: option.id,
        label: option.label.trim(),
        ...(description ? { description } : {}),
      };
    });
  }

  private normalizeScheduleDate(value: string | null | undefined): Date | null {
    const normalizedValue = cleanOptionalText(value ?? undefined);
    if (!normalizedValue) {
      return null;
    }

    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid poll schedule date.');
    }

    return setMilliseconds(setSeconds(date, 0), 0);
  }

  private toPollMetadataFromEvent(
    event: EventManagerEvent,
    mode: DbPollMode,
    cacicElectionPhase: DbCacicElectionPhase | null,
    votingStyle: DbPollVotingStyle,
    voterEligibilitySource: PollMetadataData['voterEligibilitySource'],
    requireVerifiedUnespRole: boolean,
  ): PollMetadataData {
    return {
      mode,
      cacicElectionPhase,
      votingStyle,
      voterEligibilitySource,
      requireVerifiedUnespRole,
      linkedEventId: event.id,
      linkedEventName: event.name,
      linkedEventStartDate: parseEventDate(event.startDate, 'startDate'),
      linkedEventEndDate: parseEventDate(event.endDate, 'endDate'),
      linkedEventLocationDescription: event.locationDescription ?? null,
    };
  }
}
