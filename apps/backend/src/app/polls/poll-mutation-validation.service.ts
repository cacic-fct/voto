import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PollChoiceOption,
  PollElementSettings,
  PollImageReference,
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import { PollImagePlacement as DbPollImagePlacement } from '@prisma/client';
import { SavePollDto } from './dto/poll.dto';
import { cleanOptionalText, isGridElement, isOptionChoiceElement } from './poll-contract.mapper';
import { PollImageReferenceData, PollPublicationScheduleData } from './poll-records';
import { parseDateAnswerValue, parseTimeAnswerValue } from './poll-response.validator';

const MAX_ELEMENT_OPTIONS = 80;
const MAX_DESCRIPTION_IMAGES = 8;
const MAX_POLL_IMAGES = 80;
const LINEAR_SCALE_MIN_VALUES = [0, 1] as const;
const LINEAR_SCALE_MAX_MINIMUM = 2;
const LINEAR_SCALE_MAX_MAXIMUM = 10;
const STAR_RATING_MINIMUM = 3;
const STAR_RATING_MAXIMUM = 10;
const SCHEDULING_DURATION_MINIMUM = 5;
const SCHEDULING_DURATION_MAXIMUM = 480;
const SCHEDULING_INTERVAL_MINIMUM = 5;
const SCHEDULING_INTERVAL_MAXIMUM = 180;
const SCHEDULING_BUFFER_MAXIMUM = 120;
const SCHEDULING_MAX_INVITEES = 20;
const SCHEDULING_MAX_AVAILABILITY_WINDOWS = 120;
const SCHEDULING_INVITEE_MODES = ['none', 'optional', 'required'] as const satisfies readonly PollSchedulingInviteeMode[];

@Injectable()
export class PollMutationValidationService {
  validatePollInput(input: SavePollDto): void {
    if (!input.title.trim()) {
      throw new BadRequestException('Poll title is required.');
    }

    const elementIds = new Set<string>();
    for (const element of input.elements) {
      if (elementIds.has(element.id)) {
        throw new BadRequestException(`Duplicated element id: ${element.id}.`);
      }
      elementIds.add(element.id);

      if (!element.title.trim()) {
        throw new BadRequestException('Element title is required.');
      }

      const isOptionChoice = isOptionChoiceElement(element.type);
      if (isOptionChoice && element.options.length < 2) {
        throw new BadRequestException(`Element "${element.title}" needs at least two options.`);
      }

      if (!isOptionChoice && element.options.length > 0) {
        throw new BadRequestException(`Element "${element.title}" cannot have options.`);
      }

      const optionIds = new Set<string>();
      for (const option of element.options) {
        if (optionIds.has(option.id)) {
          throw new BadRequestException(`Duplicated option id: ${option.id}.`);
        }
        optionIds.add(option.id);

        if (!option.label.trim()) {
          throw new BadRequestException(`Option label is required in element "${element.title}".`);
        }
      }

      this.validateElementSettings(element);
    }

    this.validateImageReferences(input, elementIds);
  }

  validateImageReferences(input: SavePollDto, elementIds: Set<string>): void {
    const references = this.collectImageReferences(input);
    if (references.length > MAX_POLL_IMAGES) {
      throw new BadRequestException(`Polls can include at most ${MAX_POLL_IMAGES} images.`);
    }

    const seenImageIds = new Set<string>();
    for (const reference of references) {
      if (seenImageIds.has(reference.id)) {
        throw new BadRequestException('The same image cannot be embedded more than once.');
      }
      seenImageIds.add(reference.id);

      if (reference.elementId && !elementIds.has(reference.elementId)) {
        throw new BadRequestException('Poll image references an unknown element.');
      }
    }
  }

  validatePollPublicationSchedule(schedule: PollPublicationScheduleData): void {
    if (schedule.visibleFrom && schedule.votingEndsAt && schedule.votingEndsAt <= schedule.visibleFrom) {
      throw new BadRequestException('Poll voting end date must be after the visibility start date.');
    }

    if (schedule.votingStartsAt && schedule.votingEndsAt && schedule.votingEndsAt <= schedule.votingStartsAt) {
      throw new BadRequestException('Poll voting end date must be after the voting start date.');
    }
  }

  collectImageReferences(input: SavePollDto): PollImageReferenceData[] {
    const references: PollImageReferenceData[] = [
      ...this.normalizeImageReferences(input.descriptionImages, DbPollImagePlacement.POLL_DESCRIPTION, null),
    ];

    for (const element of input.elements) {
      references.push(
        ...this.normalizeImageReferences(
          element.descriptionImages,
          DbPollImagePlacement.ELEMENT_DESCRIPTION,
          element.id,
        ),
      );
    }

    return references;
  }

  normalizeImageReferences(
    images: readonly PollImageReference[] | undefined,
    placement: 'POLL_DESCRIPTION' | 'ELEMENT_DESCRIPTION',
    elementId: string | null,
  ): PollImageReferenceData[] {
    if (!images?.length) {
      return [];
    }

    if (images.length > MAX_DESCRIPTION_IMAGES) {
      throw new BadRequestException(`Each description can include at most ${MAX_DESCRIPTION_IMAGES} images.`);
    }

    return images.map((image, position) => {
      if (!image.id.trim()) {
        throw new BadRequestException('Poll image id is required.');
      }

      const altText = cleanOptionalText(image.altText);
      const caption = cleanOptionalText(image.caption);
      return {
        id: image.id.trim(),
        placement,
        elementId,
        position,
        ...(altText ? { altText } : {}),
        ...(caption ? { caption } : {}),
      };
    });
  }

  validateElementSettings(element: SavePollDto['elements'][number]): void {
    if (isGridElement(element.type)) {
      this.rejectUnexpectedSettings(element, ['grid']);
      const grid = element.settings?.grid;
      if (!grid) {
        throw new BadRequestException(`Element "${element.title}" needs grid settings.`);
      }

      this.validateSettingsOptions(grid.rows, `Rows in element "${element.title}"`, 1);
      this.validateSettingsOptions(grid.columns, `Columns in element "${element.title}"`, 2);
      return;
    }

    if (element.type === 'linearScale') {
      this.rejectUnexpectedSettings(element, ['linearScale']);
      const scale = element.settings?.linearScale;
      if (!scale) {
        throw new BadRequestException(`Element "${element.title}" needs linear scale settings.`);
      }

      if (!Number.isInteger(scale.min) || !LINEAR_SCALE_MIN_VALUES.includes(scale.min)) {
        throw new BadRequestException(`Element "${element.title}" linear scale must start at 0 or 1.`);
      }

      if (
        !Number.isInteger(scale.max) ||
        scale.max < LINEAR_SCALE_MAX_MINIMUM ||
        scale.max > LINEAR_SCALE_MAX_MAXIMUM ||
        scale.max <= scale.min
      ) {
        throw new BadRequestException(`Element "${element.title}" linear scale must end between 2 and 10.`);
      }
      return;
    }

    if (element.type === 'starRating') {
      this.rejectUnexpectedSettings(element, ['starRating']);
      const rating = element.settings?.starRating;
      if (!rating) {
        throw new BadRequestException(`Element "${element.title}" needs star rating settings.`);
      }

      if (!Number.isInteger(rating.max) || rating.max < STAR_RATING_MINIMUM || rating.max > STAR_RATING_MAXIMUM) {
        throw new BadRequestException(`Element "${element.title}" star rating must be between 3 and 10.`);
      }
      return;
    }

    if (element.type === 'scheduling') {
      this.rejectUnexpectedSettings(element, ['scheduling']);
      const scheduling = element.settings?.scheduling;
      if (!scheduling) {
        throw new BadRequestException(`Element "${element.title}" needs scheduling settings.`);
      }

      this.validateSchedulingSettings(element.title, scheduling);
      return;
    }

    this.rejectUnexpectedSettings(element, []);
  }

  rejectUnexpectedSettings(
    element: SavePollDto['elements'][number],
    allowedSettings: (keyof PollElementSettings)[],
  ): void {
    if (!element.settings) {
      return;
    }

    const allowed = new Set<keyof PollElementSettings>(allowedSettings);
    for (const key of ['grid', 'linearScale', 'starRating', 'scheduling'] as const) {
      if (element.settings[key] && !allowed.has(key)) {
        throw new BadRequestException(`Element "${element.title}" has settings that do not match its type.`);
      }
    }
  }

  validateSettingsOptions(options: readonly PollChoiceOption[], label: string, minimumSize: number): void {
    if (options.length < minimumSize) {
      throw new BadRequestException(`${label} must include at least ${minimumSize} item(s).`);
    }

    if (options.length > MAX_ELEMENT_OPTIONS) {
      throw new BadRequestException(`${label} must include at most ${MAX_ELEMENT_OPTIONS} items.`);
    }

    const optionIds = new Set<string>();
    for (const option of options) {
      if (optionIds.has(option.id)) {
        throw new BadRequestException(`Duplicated option id: ${option.id}.`);
      }
      optionIds.add(option.id);

      if (!option.label.trim()) {
        throw new BadRequestException(`${label} has an item without a label.`);
      }
    }
  }

  validateSchedulingSettings(elementTitle: string, settings: PollSchedulingSettings): void {
    if (!settings.timezone.trim()) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling timezone is required.`);
    }

    this.validateSchedulingInteger(
      settings.durationMinutes,
      SCHEDULING_DURATION_MINIMUM,
      SCHEDULING_DURATION_MAXIMUM,
      `Element "${elementTitle}" scheduling duration is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.slotIntervalMinutes,
      SCHEDULING_INTERVAL_MINIMUM,
      SCHEDULING_INTERVAL_MAXIMUM,
      `Element "${elementTitle}" scheduling interval is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.bufferBeforeMinutes,
      0,
      SCHEDULING_BUFFER_MAXIMUM,
      `Element "${elementTitle}" scheduling buffer before is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.bufferAfterMinutes,
      0,
      SCHEDULING_BUFFER_MAXIMUM,
      `Element "${elementTitle}" scheduling buffer after is invalid.`,
    );

    if (!SCHEDULING_INVITEE_MODES.includes(settings.inviteeMode)) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling invitee mode is invalid.`);
    }

    this.validateSchedulingInteger(
      settings.maxInvitees,
      settings.inviteeMode === 'none' ? 0 : 1,
      SCHEDULING_MAX_INVITEES,
      `Element "${elementTitle}" scheduling invitee limit is invalid.`,
    );

    if (settings.availability.length === 0) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling availability is required.`);
    }

    if (settings.availability.length > SCHEDULING_MAX_AVAILABILITY_WINDOWS) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling availability has too many windows.`);
    }

    const windowIds = new Set<string>();
    const requiredMinutes =
      settings.bufferBeforeMinutes + settings.durationMinutes + settings.bufferAfterMinutes;

    for (const availability of settings.availability) {
      if (!availability.id.trim()) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability id is required.`);
      }

      if (windowIds.has(availability.id)) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability has duplicated ids.`);
      }
      windowIds.add(availability.id);

      parseDateAnswerValue(elementTitle, availability.date);
      const startMinutes = parseTimeAnswerValue(elementTitle, availability.startTime);
      const endMinutes = parseTimeAnswerValue(elementTitle, availability.endTime);
      if (endMinutes <= startMinutes) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability must end after it starts.`);
      }

      if (endMinutes - startMinutes < requiredMinutes) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability is shorter than the meeting.`);
      }
    }
  }

  validateSchedulingInteger(value: number, minimum: number, maximum: number, message: string): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new BadRequestException(message);
    }
  }
}
