import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Injectable, computed, signal } from '@angular/core';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatSelectChange } from '@angular/material/select';
import {
  EventManagerEvent,
  POLL_ELEMENT_TYPES,
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  Poll,
  PollChoiceOption,
  PollElement,
  PollElementType,
  PollImage,
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
  PollStatus,
  PollVoterEligibilitySource,
  PollVotingStyle,
  SavePollRequest,
} from '@org/voting-contracts';
import {
  requiresLinkedEventEligibilitySource,
  supportsVerifiedUnespRoleRequirement,
  voterEligibilityOptions,
  votingStyleOptions,
} from '../polls/poll-metadata';
import {
  ELEMENT_TYPE_OPTIONS,
  ElementTypeOption,
  GridAxis,
  SCALE_MAXIMUM_OPTIONS,
  SCALE_MINIMUM_OPTIONS,
  SCHEDULING_BUFFER_OPTIONS,
  SCHEDULING_DURATION_OPTIONS,
  SCHEDULING_INVITEE_LIMIT_OPTIONS,
  SCHEDULING_INVITEE_MODE_OPTIONS,
  SCHEDULING_SLOT_INTERVAL_OPTIONS,
  STAR_RATING_MAXIMUM_OPTIONS,
  createBlankPoll,
  createElement,
  createOption,
  createSchedulingAvailability,
  createSchedulingTimezoneOptions,
  createSettingsForType,
  elementTypeLabel,
  elementTypeOption,
  ensureChoiceOptions,
  ensureGridSettings,
  ensureLinearScaleSettings,
  ensureSchedulingSettings,
  isAnswerElement,
  isGridElement,
  isOptionChoiceElement,
  toImageReferences,
} from './poll-builder-options';

@Injectable()
export class PollBuilderDraftService {
  readonly elementTypeOptions = ELEMENT_TYPE_OPTIONS;
  readonly scaleMinimumOptions = SCALE_MINIMUM_OPTIONS;
  readonly scaleMaximumOptions = SCALE_MAXIMUM_OPTIONS;
  readonly starRatingMaximumOptions = STAR_RATING_MAXIMUM_OPTIONS;
  readonly schedulingDurationOptions = SCHEDULING_DURATION_OPTIONS;
  readonly schedulingSlotIntervalOptions = SCHEDULING_SLOT_INTERVAL_OPTIONS;
  readonly schedulingBufferOptions = SCHEDULING_BUFFER_OPTIONS;
  readonly schedulingInviteeLimitOptions = SCHEDULING_INVITEE_LIMIT_OPTIONS;
  readonly schedulingTimezoneOptions = createSchedulingTimezoneOptions();
  readonly schedulingInviteeModeOptions = SCHEDULING_INVITEE_MODE_OPTIONS;
  readonly votingStyleOptions = votingStyleOptions;
  readonly voterEligibilityOptions = voterEligibilityOptions;
  readonly draft = signal<Poll>(createBlankPoll());
  readonly canSave = computed(() => Boolean(this.draft().title.trim()));

  setDraft(poll: Poll): void {
    this.draft.set(poll);
  }

  newPoll(): void {
    this.draft.set(createBlankPoll());
  }

  addElement(type: PollElementType): void {
    this.draft.update((poll) => ({
      ...poll,
      elements: [...poll.elements, createElement(type)],
    }));
  }

  dropElement(event: CdkDragDrop<PollElement[]>): void {
    this.draft.update((poll) => {
      const elements = [...poll.elements];
      moveItemInArray(elements, event.previousIndex, event.currentIndex);
      return { ...poll, elements };
    });
  }

  removeElement(elementId: string): void {
    this.draft.update((poll) => ({
      ...poll,
      elements: poll.elements.filter((element) => element.id !== elementId),
    }));
  }

  addOption(elementId: string): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      options: [...element.options, createOption(element.options.length + 1)],
    }));
  }

  removeOption(elementId: string, optionId: string): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      options: element.options.filter((option) => option.id !== optionId),
    }));
  }

  addGridOption(elementId: string, axis: GridAxis): void {
    this.updateElement(elementId, (element) => {
      const grid = ensureGridSettings(element.settings?.grid);
      return {
        ...element,
        settings: {
          ...element.settings,
          grid: {
            ...grid,
            [axis]: [...grid[axis], createOption(grid[axis].length + 1)],
          },
        },
      };
    });
  }

  removeGridOption(elementId: string, axis: GridAxis, optionId: string): void {
    this.updateElement(elementId, (element) => {
      const grid = ensureGridSettings(element.settings?.grid);
      return {
        ...element,
        settings: {
          ...element.settings,
          grid: {
            ...grid,
            [axis]: grid[axis].filter((option) => option.id !== optionId),
          },
        },
      };
    });
  }

  updateGridOptionLabel(elementId: string, axis: GridAxis, optionId: string, event: Event): void {
    this.updateGridOption(elementId, axis, optionId, (option) => ({
      ...option,
      label: this.readInputValue(event),
    }));
  }

  updateGridOptionDescription(elementId: string, axis: GridAxis, optionId: string, event: Event): void {
    this.updateGridOption(elementId, axis, optionId, (option) => ({
      ...option,
      description: this.readInputValue(event),
    }));
  }

  updatePollTitle(event: Event): void {
    this.draft.update((poll) => ({ ...poll, title: this.readInputValue(event) }));
  }

  updatePollDescription(event: Event): void {
    this.draft.update((poll) => ({ ...poll, description: this.readInputValue(event) }));
  }

  addPollDescriptionImage(image: PollImage): void {
    this.draft.update((poll) => ({
      ...poll,
      descriptionImages: [...(poll.descriptionImages ?? []), image],
    }));
  }

  removePollDescriptionImage(imageId: string): void {
    this.draft.update((poll) => ({
      ...poll,
      descriptionImages: (poll.descriptionImages ?? []).filter((image) => image.id !== imageId),
    }));
  }

  updatePollDescriptionImageText(imageId: string, field: 'altText' | 'caption', event: Event): void {
    const value = this.readInputValue(event);
    this.draft.update((poll) => ({
      ...poll,
      descriptionImages: (poll.descriptionImages ?? []).map((image) =>
        image.id === imageId ? { ...image, [field]: value } : image,
      ),
    }));
  }

  updateLinkedEvent(event: MatSelectChange, events: EventManagerEvent[]): void {
    const eventId = typeof event.value === 'string' ? event.value : '';
    const linkedEvent = events.find((item) => item.id === eventId);

    this.draft.update((poll) => ({
      ...poll,
      linkedEvent: linkedEvent
        ? {
            id: linkedEvent.id,
            name: linkedEvent.name,
            startDate: linkedEvent.startDate,
            endDate: linkedEvent.endDate,
            locationDescription: linkedEvent.locationDescription,
          }
        : undefined,
      voterEligibilitySource:
        linkedEvent || !requiresLinkedEventEligibilitySource(poll.voterEligibilitySource)
          ? poll.voterEligibilitySource
          : 'authenticatedUsers',
      requireVerifiedUnespRole:
        linkedEvent || !requiresLinkedEventEligibilitySource(poll.voterEligibilitySource)
          ? poll.requireVerifiedUnespRole
          : false,
    }));
  }

  updateVotingStyle(event: MatSelectChange): void {
    const votingStyle = event.value as PollVotingStyle;
    if (!POLL_VOTING_STYLES.includes(votingStyle)) {
      return;
    }

    this.draft.update((poll) => ({
      ...poll,
      votingStyle,
      allowResponseEditing: votingStyle === 'anonymous' ? false : poll.allowResponseEditing,
    }));
  }

  updateVoterEligibilitySource(event: MatSelectChange): void {
    const source = event.value as PollVoterEligibilitySource;
    if (!POLL_VOTER_ELIGIBILITY_SOURCES.includes(source)) {
      return;
    }

    this.draft.update((poll) => {
      const voterEligibilitySource =
        requiresLinkedEventEligibilitySource(source) && !poll.linkedEvent ? 'authenticatedUsers' : source;

      return {
        ...poll,
        voterEligibilitySource,
        requireVerifiedUnespRole: supportsVerifiedUnespRoleRequirement(voterEligibilitySource)
          ? poll.requireVerifiedUnespRole
          : false,
      };
    });
  }

  updateRequireVerifiedUnespRole(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      requireVerifiedUnespRole: supportsVerifiedUnespRoleRequirement(poll.voterEligibilitySource) && event.checked,
    }));
  }

  updateDirectLinkEnabled(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      directLinkEnabled: event.checked,
    }));
  }

  updateResultsPublic(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      resultsPublic: event.checked,
      resultsLive: event.checked ? poll.resultsLive : false,
    }));
  }

  updateResultsLive(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      resultsLive: poll.resultsPublic && event.checked,
    }));
  }

  updateAllowResponseEditing(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      allowResponseEditing: poll.votingStyle !== 'anonymous' && !poll.allowMultipleResponses && event.checked,
    }));
  }

  updateAllowMultipleResponses(event: MatCheckboxChange): void {
    this.draft.update((poll) => ({
      ...poll,
      allowMultipleResponses: event.checked,
      allowResponseEditing: event.checked ? false : poll.allowResponseEditing,
    }));
  }

  updateElementType(elementId: string, event: MatSelectChange): void {
    const nextType = event.value as PollElementType;
    if (!POLL_ELEMENT_TYPES.includes(nextType)) {
      return;
    }

    this.updateElement(elementId, (element) => ({
      ...element,
      type: nextType,
      required: isAnswerElement(nextType) ? element.required : false,
      options: isOptionChoiceElement(nextType) ? ensureChoiceOptions(element.options) : [],
      settings: createSettingsForType(nextType, element.settings),
    }));
  }

  updateElementTitle(elementId: string, event: Event): void {
    this.updateElement(elementId, (element) => ({ ...element, title: this.readInputValue(event) }));
  }

  updateElementDescription(elementId: string, event: Event): void {
    this.updateElement(elementId, (element) => ({ ...element, description: this.readInputValue(event) }));
  }

  addElementDescriptionImage(elementId: string, image: PollImage): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      descriptionImages: [...(element.descriptionImages ?? []), image],
    }));
  }

  removeElementDescriptionImage(elementId: string, imageId: string): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      descriptionImages: (element.descriptionImages ?? []).filter((image) => image.id !== imageId),
    }));
  }

  updateElementDescriptionImageText(
    elementId: string,
    imageId: string,
    field: 'altText' | 'caption',
    event: Event,
  ): void {
    const value = this.readInputValue(event);
    this.updateElement(elementId, (element) => ({
      ...element,
      descriptionImages: (element.descriptionImages ?? []).map((image) =>
        image.id === imageId ? { ...image, [field]: value } : image,
      ),
    }));
  }

  updateElementRequired(elementId: string, event: MatCheckboxChange): void {
    this.updateElement(elementId, (element) => ({ ...element, required: event.checked }));
  }

  updateLinearScaleMin(elementId: string, event: MatSelectChange): void {
    const min = this.readNumberValue(event);
    if (min !== 0 && min !== 1) {
      return;
    }

    this.updateElement(elementId, (element) => {
      const scale = ensureLinearScaleSettings(element.settings?.linearScale);
      return {
        ...element,
        settings: {
          ...element.settings,
          linearScale: {
            ...scale,
            min,
            max: Math.max(scale.max, min + 1),
          },
        },
      };
    });
  }

  updateLinearScaleMax(elementId: string, event: MatSelectChange): void {
    const max = this.readNumberValue(event);
    if (!max || max < 2 || max > 10) {
      return;
    }

    this.updateElement(elementId, (element) => {
      const scale = ensureLinearScaleSettings(element.settings?.linearScale);
      return {
        ...element,
        settings: {
          ...element.settings,
          linearScale: {
            ...scale,
            max: Math.max(max, scale.min + 1),
          },
        },
      };
    });
  }

  updateLinearScaleLabel(elementId: string, label: 'minLabel' | 'maxLabel', event: Event): void {
    this.updateElement(elementId, (element) => {
      const scale = ensureLinearScaleSettings(element.settings?.linearScale);
      return {
        ...element,
        settings: {
          ...element.settings,
          linearScale: {
            ...scale,
            [label]: this.readInputValue(event),
          },
        },
      };
    });
  }

  updateStarRatingMax(elementId: string, event: MatSelectChange): void {
    const max = this.readNumberValue(event);
    if (!max || max < 3 || max > 10) {
      return;
    }

    this.updateElement(elementId, (element) => ({
      ...element,
      settings: {
        ...element.settings,
        starRating: {
          max,
        },
      },
    }));
  }

  updateSchedulingText(
    elementId: string,
    field: 'hostName' | 'location',
    event: Event,
  ): void {
    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      [field]: this.readInputValue(event),
    }));
  }

  updateSchedulingTimezone(elementId: string, event: MatSelectChange): void {
    const timezone = typeof event.value === 'string' ? event.value : '';
    if (!timezone) {
      return;
    }

    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      timezone,
    }));
  }

  updateSchedulingNumber(
    elementId: string,
    field:
      | 'durationMinutes'
      | 'slotIntervalMinutes'
      | 'bufferBeforeMinutes'
      | 'bufferAfterMinutes'
      | 'maxInvitees',
    event: MatSelectChange,
  ): void {
    const value = this.readNumberValue(event);
    if (value === null) {
      return;
    }

    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      [field]: value,
    }));
  }

  updateSchedulingInviteeMode(elementId: string, event: MatSelectChange): void {
    const inviteeMode = event.value as PollSchedulingInviteeMode;
    if (!this.schedulingInviteeModeOptions.some((option) => option.mode === inviteeMode)) {
      return;
    }

    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      inviteeMode,
      maxInvitees: inviteeMode === 'none' ? 0 : Math.max(settings.maxInvitees, 1),
    }));
  }

  addSchedulingAvailability(elementId: string): void {
    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      availability: [
        ...settings.availability,
        createSchedulingAvailability(
          settings.availability.length + 1,
          0,
          settings.availability[settings.availability.length - 1]?.date,
        ),
      ],
    }));
  }

  removeSchedulingAvailability(elementId: string, availabilityId: string): void {
    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      availability: settings.availability.filter((availability) => availability.id !== availabilityId),
    }));
  }

  updateSchedulingAvailability(
    elementId: string,
    availabilityId: string,
    field: 'date' | 'startTime' | 'endTime',
    event: Event,
  ): void {
    this.updateSchedulingSettings(elementId, (settings) => ({
      ...settings,
      availability: settings.availability.map((availability) =>
        availability.id === availabilityId
          ? {
              ...availability,
              [field]: this.readInputValue(event),
            }
          : availability,
      ),
    }));
  }

  updateOptionLabel(elementId: string, optionId: string, event: Event): void {
    this.updateOption(elementId, optionId, (option) => ({ ...option, label: this.readInputValue(event) }));
  }

  updateOptionDescription(elementId: string, optionId: string, event: Event): void {
    this.updateOption(elementId, optionId, (option) => ({ ...option, description: this.readInputValue(event) }));
  }

  isOptionChoiceElement(type: PollElementType): boolean {
    return isOptionChoiceElement(type);
  }

  isGridElement(type: PollElementType): boolean {
    return isGridElement(type);
  }

  isAnswerElement(type: PollElementType): boolean {
    return isAnswerElement(type);
  }

  elementTypeLabel(type: PollElementType): string {
    return elementTypeLabel(type);
  }

  elementTypeOption(type: PollElementType): ElementTypeOption {
    return elementTypeOption(type);
  }

  statusLabel(status: PollStatus): string {
    switch (status) {
      case 'draft':
        return 'Rascunho';
      case 'published':
        return 'Publicada';
      case 'closed':
        return 'Encerrada';
    }
  }

  toSaveRequest(poll = this.draft()): SavePollRequest {
    return {
      title: poll.title,
      description: poll.description,
      descriptionImages: toImageReferences(poll.descriptionImages),
      status: poll.status,
      votingStyle: poll.votingStyle,
      voterEligibilitySource: poll.voterEligibilitySource,
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsPublic && poll.resultsLive,
      allowResponseEditing: poll.votingStyle !== 'anonymous' && !poll.allowMultipleResponses && poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEventId: poll.linkedEvent?.id,
      elements: poll.elements.map((element) => ({
        ...element,
        descriptionImages: toImageReferences(element.descriptionImages),
      })),
    };
  }

  private updateElement(elementId: string, update: (element: PollElement) => PollElement): void {
    this.draft.update((poll) => ({
      ...poll,
      elements: poll.elements.map((element) => (element.id === elementId ? update(element) : element)),
    }));
  }

  private updateOption(
    elementId: string,
    optionId: string,
    update: (option: PollChoiceOption) => PollChoiceOption,
  ): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      options: element.options.map((option) => (option.id === optionId ? update(option) : option)),
    }));
  }

  private updateGridOption(
    elementId: string,
    axis: GridAxis,
    optionId: string,
    update: (option: PollChoiceOption) => PollChoiceOption,
  ): void {
    this.updateElement(elementId, (element) => {
      const grid = ensureGridSettings(element.settings?.grid);
      return {
        ...element,
        settings: {
          ...element.settings,
          grid: {
            ...grid,
            [axis]: grid[axis].map((option) => (option.id === optionId ? update(option) : option)),
          },
        },
      };
    });
  }

  private updateSchedulingSettings(
    elementId: string,
    update: (settings: PollSchedulingSettings) => PollSchedulingSettings,
  ): void {
    this.updateElement(elementId, (element) => ({
      ...element,
      settings: {
        ...element.settings,
        scheduling: update(ensureSchedulingSettings(element.settings?.scheduling)),
      },
    }));
  }

  private readInputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
  }

  private readNumberValue(event: MatSelectChange): number | null {
    return typeof event.value === 'number' && Number.isInteger(event.value) ? event.value : null;
  }

}
