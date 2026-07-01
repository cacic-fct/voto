import { computed, signal } from '@angular/core';
import { MatSelectChange } from '@angular/material/select';
import {
  Poll,
  PollElement,
  PollElementType,
  PollStatus,
  SavePollRequest,
} from '@org/voting-contracts';
import { voterEligibilityOptions, votingStyleOptions } from '../polls/poll-metadata';
import {
  CACIC_ELECTION_PHASE_OPTIONS,
  ELEMENT_TYPE_OPTIONS,
  ElementTypeOption,
  POLL_MODE_OPTIONS,
  SCALE_MAXIMUM_OPTIONS,
  SCALE_MINIMUM_OPTIONS,
  SCHEDULING_BUFFER_OPTIONS,
  SCHEDULING_DURATION_OPTIONS,
  SCHEDULING_INVITEE_LIMIT_OPTIONS,
  SCHEDULING_INVITEE_MODE_OPTIONS,
  SCHEDULING_SLOT_INTERVAL_OPTIONS,
  STAR_RATING_MAXIMUM_OPTIONS,
  createBlankPoll,
  createCacicElectionSlateFormPreviewElement,
  createCacicElectionVotePreviewElement,
  createSchedulingTimezoneOptions,
  elementTypeLabel,
  elementTypeOption,
  ensureCacicElectionGeneratedElement,
  generatedCacicElectionElementFields,
  isAnswerElement as isAnswerElementType,
  isCacicElectionGeneratedElement,
  isGridElement as isGridElementType,
  isOptionChoiceElement as isOptionChoiceElementType,
  toImageReferences,
} from './poll-builder-options';

export abstract class PollBuilderDraftState {
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
  readonly pollModeOptions = POLL_MODE_OPTIONS;
  readonly cacicElectionPhaseOptions = CACIC_ELECTION_PHASE_OPTIONS;
  readonly votingStyleOptions = votingStyleOptions;
  readonly voterEligibilityOptions = voterEligibilityOptions;
  readonly draft = signal<Poll>(createBlankPoll());
  readonly canSave = computed(() => Boolean(this.draft().title.trim()));

  setDraft(poll: Poll): void {
    this.draft.set(this.applyCacicElectionRules(poll));
  }

  newPoll(): void {
    this.draft.set(createBlankPoll());
  }

  isOptionChoiceElement(type: PollElementType): boolean {
    return isOptionChoiceElementType(type);
  }

  isGridElement(type: PollElementType): boolean {
    return isGridElementType(type);
  }

  isAnswerElement(type: PollElementType): boolean {
    return isAnswerElementType(type);
  }

  isCacicElection(poll = this.draft()): boolean {
    return poll.mode === 'cacicElection';
  }

  isCacicElectionVoting(poll = this.draft()): boolean {
    return poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'election';
  }

  isCacicElectionSlateSubmission(poll = this.draft()): boolean {
    return poll.mode === 'cacicElection' && poll.cacicElectionPhase === 'slateSubmission';
  }

  isCacicElectionGeneratedElement(element: PollElement): boolean {
    return isCacicElectionGeneratedElement(element);
  }

  generatedCacicElectionElementFields(element: PollElement): string[] {
    return generatedCacicElectionElementFields(element);
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

  dateTimeInputValue(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  toSaveRequest(poll = this.draft()): SavePollRequest {
    const normalizedPoll = this.applyCacicElectionRules(poll);
    return {
      title: normalizedPoll.title,
      description: normalizedPoll.description,
      descriptionImages: toImageReferences(normalizedPoll.descriptionImages),
      status: normalizedPoll.status,
      mode: normalizedPoll.mode,
      cacicElectionPhase: normalizedPoll.cacicElectionPhase,
      votingStyle: normalizedPoll.votingStyle,
      voterEligibilitySource: normalizedPoll.voterEligibilitySource,
      requireVerifiedUnespRole: normalizedPoll.requireVerifiedUnespRole,
      directLinkEnabled: normalizedPoll.directLinkEnabled,
      resultsPublic: normalizedPoll.resultsPublic,
      resultsLive: normalizedPoll.resultsPublic && normalizedPoll.resultsLive,
      allowResponseEditing:
        normalizedPoll.votingStyle !== 'anonymous' &&
        !normalizedPoll.allowMultipleResponses &&
        normalizedPoll.allowResponseEditing,
      allowMultipleResponses: normalizedPoll.allowMultipleResponses,
      visibleFrom: normalizedPoll.visibleFrom,
      votingStartsAt: normalizedPoll.votingStartsAt,
      votingEndsAt: normalizedPoll.votingEndsAt,
      linkedEventId: normalizedPoll.linkedEvent?.id,
      elements: normalizedPoll.elements.map((element) => ({
        ...element,
        descriptionImages: toImageReferences(element.descriptionImages),
      })),
    };
  }

  protected readInputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
  }

  protected readDateTimeInputValue(event: Event): string | null {
    const value = this.readInputValue(event);
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setSeconds(0, 0);
    return date.toISOString();
  }

  protected readNumberValue(event: MatSelectChange): number | null {
    return typeof event.value === 'number' && Number.isInteger(event.value) ? event.value : null;
  }

  protected applyCacicElectionRules(poll: Poll): Poll {
    if (poll.mode !== 'cacicElection') {
      return {
        ...poll,
        mode: 'regular',
        cacicElectionPhase: undefined,
        elements: poll.elements.filter((element) => !isCacicElectionGeneratedElement(element)),
      };
    }

    const cacicElectionPhase = poll.cacicElectionPhase ?? 'slateSubmission';
    const basePoll: Poll = {
      ...poll,
      mode: 'cacicElection',
      cacicElectionPhase,
      directLinkEnabled: false,
    };

    if (cacicElectionPhase === 'election') {
      return {
        ...basePoll,
        votingStyle: 'anonymous',
        voterEligibilitySource: 'enrollmentList',
        requireVerifiedUnespRole: false,
        linkedEvent: undefined,
        resultsPublic: true,
        resultsLive: false,
        allowResponseEditing: false,
        allowMultipleResponses: false,
        elements: ensureCacicElectionGeneratedElement(
          poll.elements,
          createCacicElectionVotePreviewElement(),
        ),
      };
    }

    return {
      ...basePoll,
      resultsPublic: false,
      resultsLive: false,
      elements: ensureCacicElectionGeneratedElement(
        poll.elements,
        createCacicElectionSlateFormPreviewElement(),
      ),
    };
  }
}
