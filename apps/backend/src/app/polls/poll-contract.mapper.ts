import {
  Poll,
  PollElement,
  PollElementSettings,
  PollElementType,
  PollImage,
  PollLinkedEvent,
  PollStatus,
  PollVoterEligibilitySource,
  PollVotingStyle,
} from '@org/voting-contracts';
import {
  BadRequestException,
} from '@nestjs/common';
import {
  PollElementType as DbPollElementType,
  PollImagePlacement as DbPollImagePlacement,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';
import { ElementRecord, ImageRecord, PollContractOptions, PollRecord } from './poll-records';
import { isRecord } from './poll-user-claims';

export function readElementSettings(element: ElementRecord): PollElementSettings {
  return isRecord(element.settings) ? (element.settings as PollElementSettings) : {};
}

export function toContractPoll(poll: PollRecord, options: PollContractOptions = {}): Poll {
  const pollImages = poll.images ?? [];
  const descriptionImages = toContractImages(
    pollImages.filter((image) => image.placement === DbPollImagePlacement.POLL_DESCRIPTION),
    options,
  );
  const imagesByElementId = new Map<string, ImageRecord[]>();
  for (const image of pollImages) {
    if (image.placement !== DbPollImagePlacement.ELEMENT_DESCRIPTION || !image.elementId) {
      continue;
    }

    imagesByElementId.set(image.elementId, [...(imagesByElementId.get(image.elementId) ?? []), image]);
  }

  return {
    id: poll.id,
    title: poll.title,
    description: poll.description ?? undefined,
    ...(descriptionImages.length > 0 ? { descriptionImages } : {}),
    status: toContractStatus(poll.status),
    votingStyle: toContractVotingStyle(poll.votingStyle),
    voterEligibilitySource: toContractVoterEligibilitySource(poll.voterEligibilitySource),
    requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
    directLinkEnabled: poll.directLinkEnabled,
    ...(options.includeDirectLinkToken && poll.directLinkToken ? { directLinkToken: poll.directLinkToken } : {}),
    resultsPublic: poll.resultsPublic,
    resultsLive: poll.resultsLive,
    allowResponseEditing: poll.allowResponseEditing,
    allowMultipleResponses: poll.allowMultipleResponses,
    linkedEvent: toContractLinkedEvent(poll),
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString(),
    publishedAt: poll.publishedAt?.toISOString(),
    elements: poll.elements.map((element) =>
      toContractElement(element, imagesByElementId.get(element.id) ?? [], options),
    ),
  };
}

export function toContractElement(
  element: ElementRecord,
  images: ImageRecord[],
  options: PollContractOptions,
): PollElement {
  const settings = toContractElementSettings(element);
  const descriptionImages = toContractImages(images, options);

  return {
    id: element.id,
    type: toContractElementType(element.type),
    title: element.title,
    description: element.description ?? undefined,
    ...(descriptionImages.length > 0 ? { descriptionImages } : {}),
    required: element.required,
    options: element.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description ?? undefined,
    })),
    ...(settings ? { settings } : {}),
  };
}

export function toElementSnapshotJson(element: ElementRecord): Prisma.InputJsonValue {
  return toContractElement(element, [], {}) as unknown as Prisma.InputJsonValue;
}

export function toContractImages(images: ImageRecord[], options: PollContractOptions = {}): PollImage[] {
  return [...images]
    .sort((left, right) => left.position - right.position)
    .map((image) => ({
      id: image.id,
      url: options.imageDirectLinkToken
        ? `/api/polls/direct/${encodeURIComponent(options.imageDirectLinkToken)}/images/${encodeURIComponent(image.id)}`
        : `/api/polls/${encodeURIComponent(image.pollId)}/images/${encodeURIComponent(image.id)}`,
      width: image.width,
      height: image.height,
      altText: image.altText ?? undefined,
      caption: image.caption ?? undefined,
    }));
}

export function toContractElementSettings(element: ElementRecord): PollElementSettings | undefined {
  const settings = readElementSettings(element);
  const type = toContractElementType(element.type);

  if (isGridElement(type) && settings.grid) {
    return { grid: settings.grid };
  }

  if (type === 'linearScale' && settings.linearScale) {
    return { linearScale: settings.linearScale };
  }

  if (type === 'starRating' && settings.starRating) {
    return { starRating: settings.starRating };
  }

  if (type === 'scheduling' && settings.scheduling) {
    return { scheduling: settings.scheduling };
  }

  return undefined;
}

export function toContractLinkedEvent(poll: {
  linkedEventId: string | null;
  linkedEventName: string | null;
  linkedEventStartDate: Date | null;
  linkedEventEndDate: Date | null;
  linkedEventLocationDescription: string | null;
}): PollLinkedEvent | undefined {
  if (!poll.linkedEventId || !poll.linkedEventName || !poll.linkedEventStartDate || !poll.linkedEventEndDate) {
    return undefined;
  }

  return {
    id: poll.linkedEventId,
    name: poll.linkedEventName,
    startDate: poll.linkedEventStartDate.toISOString(),
    endDate: poll.linkedEventEndDate.toISOString(),
    locationDescription: poll.linkedEventLocationDescription ?? undefined,
  };
}

export function toDbStatus(status: PollStatus): DbPollStatus {
  switch (status) {
    case 'draft':
      return DbPollStatus.DRAFT;
    case 'published':
      return DbPollStatus.PUBLISHED;
    case 'closed':
      return DbPollStatus.CLOSED;
  }
}

export function toContractStatus(status: DbPollStatus): PollStatus {
  switch (status) {
    case DbPollStatus.DRAFT:
      return 'draft';
    case DbPollStatus.PUBLISHED:
      return 'published';
    case DbPollStatus.CLOSED:
      return 'closed';
  }
}

export function toDbVotingStyle(style: PollVotingStyle): DbPollVotingStyle {
  switch (style) {
    case 'public':
      return DbPollVotingStyle.PUBLIC;
    case 'partiallySecret':
      return DbPollVotingStyle.PARTIALLY_SECRET;
    case 'secret':
      return DbPollVotingStyle.SECRET;
    case 'anonymous':
      return DbPollVotingStyle.ANONYMOUS;
  }
}

export function toContractVotingStyle(style: DbPollVotingStyle): PollVotingStyle {
  switch (style) {
    case DbPollVotingStyle.PUBLIC:
      return 'public';
    case DbPollVotingStyle.PARTIALLY_SECRET:
      return 'partiallySecret';
    case DbPollVotingStyle.SECRET:
      return 'secret';
    case DbPollVotingStyle.ANONYMOUS:
      return 'anonymous';
  }
}

export function toDbVoterEligibilitySource(source: PollVoterEligibilitySource): DbPollVoterEligibilitySource {
  switch (source) {
    case 'authenticatedUsers':
      return DbPollVoterEligibilitySource.AUTHENTICATED_USERS;
    case 'unespUsers':
      return DbPollVoterEligibilitySource.UNESP_USERS;
    case 'computerScienceStudents':
      return DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS;
    case 'eventAttendance':
      return DbPollVoterEligibilitySource.EVENT_ATTENDANCE;
    case 'eventAttendanceUnespUsers':
      return DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS;
    case 'eventAttendanceComputerScienceStudents':
      return DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS;
    case 'enrollmentList':
      return DbPollVoterEligibilitySource.ENROLLMENT_LIST;
  }
}

export function toContractVoterEligibilitySource(source: DbPollVoterEligibilitySource): PollVoterEligibilitySource {
  switch (source) {
    case DbPollVoterEligibilitySource.AUTHENTICATED_USERS:
      return 'authenticatedUsers';
    case DbPollVoterEligibilitySource.UNESP_USERS:
      return 'unespUsers';
    case DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS:
      return 'computerScienceStudents';
    case DbPollVoterEligibilitySource.EVENT_ATTENDANCE:
      return 'eventAttendance';
    case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS:
      return 'eventAttendanceUnespUsers';
    case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS:
      return 'eventAttendanceComputerScienceStudents';
    case DbPollVoterEligibilitySource.ENROLLMENT_LIST:
      return 'enrollmentList';
  }
}

export function isEventAttendanceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
  return (
    source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE ||
    source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS ||
    source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS
  );
}

export function isComputerScienceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
  return (
    source === DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS ||
    source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS
  );
}

export function isOptionChoiceElement(type: PollElementType): boolean {
  return type === 'singleChoice' || type === 'multipleChoice' || type === 'selectionDropdown';
}

export function isGridElement(type: PollElementType): boolean {
  return type === 'singleSelectionGrid' || type === 'multipleSelectionGrid';
}

export function toDbElementType(type: PollElementType): DbPollElementType {
  switch (type) {
    case 'section':
      return DbPollElementType.SECTION;
    case 'statement':
      return DbPollElementType.STATEMENT;
    case 'shortText':
      return DbPollElementType.SHORT_TEXT;
    case 'longText':
      return DbPollElementType.LONG_TEXT;
    case 'singleChoice':
      return DbPollElementType.SINGLE_CHOICE;
    case 'multipleChoice':
      return DbPollElementType.MULTIPLE_CHOICE;
    case 'singleSelectionGrid':
      return DbPollElementType.SINGLE_SELECTION_GRID;
    case 'multipleSelectionGrid':
      return DbPollElementType.MULTIPLE_SELECTION_GRID;
    case 'selectionDropdown':
      return DbPollElementType.SELECTION_DROPDOWN;
    case 'linearScale':
      return DbPollElementType.LINEAR_SCALE;
    case 'starRating':
      return DbPollElementType.STAR_RATING;
    case 'date':
      return DbPollElementType.DATE;
    case 'time':
      return DbPollElementType.TIME;
    case 'scheduling':
      return DbPollElementType.SCHEDULING;
  }
}

export function toContractElementType(type: DbPollElementType): PollElementType {
  switch (type) {
    case DbPollElementType.SECTION:
      return 'section';
    case DbPollElementType.STATEMENT:
      return 'statement';
    case DbPollElementType.SHORT_TEXT:
      return 'shortText';
    case DbPollElementType.LONG_TEXT:
      return 'longText';
    case DbPollElementType.SINGLE_CHOICE:
      return 'singleChoice';
    case DbPollElementType.MULTIPLE_CHOICE:
      return 'multipleChoice';
    case DbPollElementType.SINGLE_SELECTION_GRID:
      return 'singleSelectionGrid';
    case DbPollElementType.MULTIPLE_SELECTION_GRID:
      return 'multipleSelectionGrid';
    case DbPollElementType.SELECTION_DROPDOWN:
      return 'selectionDropdown';
    case DbPollElementType.LINEAR_SCALE:
      return 'linearScale';
    case DbPollElementType.STAR_RATING:
      return 'starRating';
    case DbPollElementType.DATE:
      return 'date';
    case DbPollElementType.TIME:
      return 'time';
    case DbPollElementType.SCHEDULING:
      return 'scheduling';
  }
}

export function cleanOptionalText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function parseEventDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Linked event ${fieldName} is invalid.`);
  }

  return date;
}
