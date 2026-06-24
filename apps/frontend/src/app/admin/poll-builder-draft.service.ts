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
  PollElementSettings,
  PollElementType,
  PollGridSettings,
  PollImage,
  PollImageReference,
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

export type ElementTypeOption = {
  type: PollElementType;
  label: string;
  icon: string;
};

type GridAxis = keyof PollGridSettings;

export const ELEMENT_TYPE_OPTIONS: ElementTypeOption[] = [
  { type: 'section', label: 'Seção', icon: 'splitscreen' },
  { type: 'statement', label: 'Texto informativo', icon: 'notes' },
  { type: 'shortText', label: 'Resposta curta', icon: 'short_text' },
  { type: 'longText', label: 'Resposta longa', icon: 'subject' },
  { type: 'singleChoice', label: 'Escolha única', icon: 'radio_button_checked' },
  { type: 'multipleChoice', label: 'Múltipla escolha', icon: 'check_box' },
  { type: 'selectionDropdown', label: 'Lista suspensa', icon: 'arrow_drop_down_circle' },
  { type: 'singleSelectionGrid', label: 'Grade de seleção única', icon: 'table_rows' },
  { type: 'multipleSelectionGrid', label: 'Grade de seleção múltipla', icon: 'checklist' },
  { type: 'linearScale', label: 'Escala linear', icon: 'linear_scale' },
  { type: 'starRating', label: 'Avaliação por estrelas', icon: 'star' },
  { type: 'date', label: 'Data', icon: 'calendar_today' },
  { type: 'time', label: 'Hora', icon: 'schedule' },
  { type: 'scheduling', label: 'Agendamento', icon: 'event_available' },
];

@Injectable()
export class PollBuilderDraftService {
  readonly elementTypeOptions = ELEMENT_TYPE_OPTIONS;
  readonly scaleMinimumOptions = [0, 1] as const;
  readonly scaleMaximumOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  readonly starRatingMaximumOptions = [3, 4, 5, 6, 7, 8, 9, 10] as const;
  readonly schedulingDurationOptions = [15, 20, 30, 45, 60, 90, 120] as const;
  readonly schedulingSlotIntervalOptions = [5, 10, 15, 20, 30, 45, 60] as const;
  readonly schedulingBufferOptions = [0, 5, 10, 15, 30, 45, 60] as const;
  readonly schedulingInviteeLimitOptions = [1, 2, 3, 4, 5, 10, 15, 20] as const;
  readonly schedulingTimezoneOptions = this.createSchedulingTimezoneOptions();
  readonly schedulingInviteeModeOptions: { mode: PollSchedulingInviteeMode; label: string }[] = [
    { mode: 'none', label: 'Não coletar convidados' },
    { mode: 'optional', label: 'Convidados opcionais' },
    { mode: 'required', label: 'Exigir pelo menos um convidado' },
  ];
  readonly votingStyleOptions = votingStyleOptions;
  readonly voterEligibilityOptions = voterEligibilityOptions;
  readonly draft = signal<Poll>(this.createBlankPoll());
  readonly canSave = computed(() => Boolean(this.draft().title.trim()));

  setDraft(poll: Poll): void {
    this.draft.set(poll);
  }

  newPoll(): void {
    this.draft.set(this.createBlankPoll());
  }

  addElement(type: PollElementType): void {
    this.draft.update((poll) => ({
      ...poll,
      elements: [...poll.elements, this.createElement(type)],
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
      options: [...element.options, this.createOption(element.options.length + 1)],
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
      const grid = this.ensureGridSettings(element.settings?.grid);
      return {
        ...element,
        settings: {
          ...element.settings,
          grid: {
            ...grid,
            [axis]: [...grid[axis], this.createOption(grid[axis].length + 1)],
          },
        },
      };
    });
  }

  removeGridOption(elementId: string, axis: GridAxis, optionId: string): void {
    this.updateElement(elementId, (element) => {
      const grid = this.ensureGridSettings(element.settings?.grid);
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
      required: this.isAnswerElement(nextType) ? element.required : false,
      options: this.isOptionChoiceElement(nextType) ? this.ensureChoiceOptions(element.options) : [],
      settings: this.createSettingsForType(nextType, element.settings),
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
      const scale = this.ensureLinearScaleSettings(element.settings?.linearScale);
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
      const scale = this.ensureLinearScaleSettings(element.settings?.linearScale);
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
      const scale = this.ensureLinearScaleSettings(element.settings?.linearScale);
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
        this.createSchedulingAvailability(
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
    return type === 'singleChoice' || type === 'multipleChoice' || type === 'selectionDropdown';
  }

  isGridElement(type: PollElementType): boolean {
    return type === 'singleSelectionGrid' || type === 'multipleSelectionGrid';
  }

  isAnswerElement(type: PollElementType): boolean {
    return type !== 'section' && type !== 'statement';
  }

  elementTypeLabel(type: PollElementType): string {
    return this.elementTypeOption(type).label;
  }

  elementTypeOption(type: PollElementType): ElementTypeOption {
    return this.elementTypeOptions.find((option) => option.type === type) ?? { type, label: type, icon: 'help' };
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
      descriptionImages: this.toImageReferences(poll.descriptionImages),
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
        descriptionImages: this.toImageReferences(element.descriptionImages),
      })),
    };
  }

  private toImageReferences(images: readonly PollImage[] | undefined): PollImageReference[] | undefined {
    if (!images?.length) {
      return undefined;
    }

    return images.map((image) => ({
      id: image.id,
      ...(image.altText?.trim() ? { altText: image.altText.trim() } : {}),
      ...(image.caption?.trim() ? { caption: image.caption.trim() } : {}),
    }));
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
      const grid = this.ensureGridSettings(element.settings?.grid);
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
        scheduling: update(this.ensureSchedulingSettings(element.settings?.scheduling)),
      },
    }));
  }

  private ensureChoiceOptions(options: PollChoiceOption[]): PollChoiceOption[] {
    return options.length >= 2 ? options : [this.createOption(1), this.createOption(2)];
  }

  private createSettingsForType(type: PollElementType, current?: PollElementSettings): PollElementSettings | undefined {
    if (this.isGridElement(type)) {
      return {
        grid: this.ensureGridSettings(current?.grid),
      };
    }

    if (type === 'linearScale') {
      return {
        linearScale: this.ensureLinearScaleSettings(current?.linearScale),
      };
    }

    if (type === 'starRating') {
      return {
        starRating: this.ensureStarRatingSettings(current?.starRating),
      };
    }

    if (type === 'scheduling') {
      return {
        scheduling: this.ensureSchedulingSettings(current?.scheduling),
      };
    }

    return undefined;
  }

  private ensureGridSettings(grid?: PollGridSettings): PollGridSettings {
    return {
      rows: grid?.rows.length ? grid.rows : [this.createOption(1), this.createOption(2)],
      columns: grid?.columns.length ? grid.columns : [this.createOption(1), this.createOption(2)],
    };
  }

  private ensureLinearScaleSettings(settings?: PollElementSettings['linearScale']): NonNullable<PollElementSettings['linearScale']> {
    const min = settings?.min === 0 ? 0 : 1;
    const max = Math.min(Math.max(settings?.max ?? 5, min + 1), 10);
    return {
      min,
      max,
      minLabel: settings?.minLabel ?? '',
      maxLabel: settings?.maxLabel ?? '',
    };
  }

  private ensureStarRatingSettings(settings?: PollElementSettings['starRating']): NonNullable<PollElementSettings['starRating']> {
    return {
      max: Math.min(Math.max(settings?.max ?? 5, 3), 10),
    };
  }

  private ensureSchedulingSettings(settings?: PollElementSettings['scheduling']): PollSchedulingSettings {
    const inviteeMode = settings?.inviteeMode ?? 'optional';
    return {
      hostName: settings?.hostName ?? '',
      location: settings?.location ?? '',
      timezone: settings?.timezone ?? 'America/Sao_Paulo',
      durationMinutes: this.clampSchedulingOption(settings?.durationMinutes, this.schedulingDurationOptions, 30),
      slotIntervalMinutes: this.clampSchedulingOption(settings?.slotIntervalMinutes, this.schedulingSlotIntervalOptions, 30),
      bufferBeforeMinutes: this.clampSchedulingOption(settings?.bufferBeforeMinutes, this.schedulingBufferOptions, 0),
      bufferAfterMinutes: this.clampSchedulingOption(settings?.bufferAfterMinutes, this.schedulingBufferOptions, 0),
      inviteeMode,
      maxInvitees:
        inviteeMode === 'none'
          ? 0
          : this.clampSchedulingOption(settings?.maxInvitees, this.schedulingInviteeLimitOptions, 3),
      availability: settings?.availability.length
        ? settings.availability
        : [this.createSchedulingAvailability(1), this.createSchedulingAvailability(2, 1)],
    };
  }

  private clampSchedulingOption<T extends number>(value: number | undefined, options: readonly T[], fallback: T): T {
    return options.includes(value as T) ? (value as T) : fallback;
  }

  private createBlankPoll(): Poll {
    return {
      id: '',
      title: '',
      description: '',
      descriptionImages: [],
      status: 'draft',
      votingStyle: 'secret',
      voterEligibilitySource: 'authenticatedUsers',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      elements: [],
      createdAt: '',
      updatedAt: '',
    };
  }

  private createElement(type: PollElementType): PollElement {
    return {
      id: this.createId('element'),
      type,
      title: this.elementTypeLabel(type),
      description: '',
      descriptionImages: [],
      required: this.isAnswerElement(type),
      options: this.isOptionChoiceElement(type) ? [this.createOption(1), this.createOption(2)] : [],
      settings: this.createSettingsForType(type),
    };
  }

  private createOption(position: number): PollChoiceOption {
    return {
      id: this.createId('option'),
      label: `Opção ${position}`,
      description: '',
    };
  }

  private createSchedulingAvailability(
    position: number,
    dayOffset = 0,
    date = this.defaultAvailabilityDate(dayOffset),
  ): PollSchedulingSettings['availability'][number] {
    return {
      id: this.createId('availability'),
      date,
      startTime: position % 2 === 0 ? '14:00' : '09:00',
      endTime: position % 2 === 0 ? '17:00' : '12:00',
    };
  }

  private createSchedulingTimezoneOptions(): string[] {
    const fallbackOptions = [
      'America/Sao_Paulo',
      'UTC',
      'America/Belem',
      'America/Fortaleza',
      'America/Manaus',
      'America/Cuiaba',
      'America/Rio_Branco',
    ];
    const intlWithTimezones = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    const supportedOptions = intlWithTimezones.supportedValuesOf?.('timeZone') ?? fallbackOptions;

    return [...new Set(['America/Sao_Paulo', ...supportedOptions])].sort((left, right) =>
      left === 'America/Sao_Paulo'
        ? -1
        : right === 'America/Sao_Paulo'
          ? 1
          : left.localeCompare(right),
    );
  }

  private defaultAvailabilityDate(dayOffset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset + 1);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private readInputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
  }

  private readNumberValue(event: MatSelectChange): number | null {
    return typeof event.value === 'number' && Number.isInteger(event.value) ? event.value : null;
  }

  private createId(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `${prefix}-${random}`;
  }
}
