import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatSelectChange } from '@angular/material/select';
import {
  CACIC_ELECTION_PHASES,
  CacicElectionPhase,
  EventManagerEvent,
  POLL_MODES,
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  PollImage,
  PollMode,
  PollVoterEligibilitySource,
  PollVotingStyle,
} from '@org/voting-contracts';
import {
  requiresLinkedEventEligibilitySource,
  supportsVerifiedUnespRoleRequirement,
} from '../polls/poll-metadata';
import { PollBuilderDraftState } from './poll-builder-draft-state';

export abstract class PollBuilderDraftPollSettings extends PollBuilderDraftState {
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

  updatePollMode(event: MatSelectChange): void {
    const mode = event.value as PollMode;
    if (!POLL_MODES.includes(mode)) {
      return;
    }

    this.draft.update((poll) => this.applyCacicElectionRules({ ...poll, mode }));
  }

  updateCacicElectionPhase(event: MatSelectChange): void {
    const phase = event.value as CacicElectionPhase;
    if (!CACIC_ELECTION_PHASES.includes(phase)) {
      return;
    }

    this.draft.update((poll) =>
      this.applyCacicElectionRules({
        ...poll,
        mode: 'cacicElection',
        cacicElectionPhase: phase,
      }),
    );
  }

  updateVisibleFrom(event: Event): void {
    this.draft.update((poll) => ({
      ...poll,
      visibleFrom: this.readDateTimeInputValue(event),
    }));
  }

  updateVotingStartsAt(event: Event): void {
    this.draft.update((poll) => ({
      ...poll,
      votingStartsAt: this.readDateTimeInputValue(event),
    }));
  }

  updateVotingEndsAt(event: Event): void {
    this.draft.update((poll) => ({
      ...poll,
      votingEndsAt: this.readDateTimeInputValue(event),
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
    this.draft.update((poll) => this.applyCacicElectionRules({ ...poll, directLinkEnabled: event.checked }));
  }

  updateResultsPublic(event: MatCheckboxChange): void {
    this.draft.update((poll) => this.applyCacicElectionRules({
      ...poll,
      resultsPublic: event.checked,
      resultsLive: event.checked ? poll.resultsLive : false,
    }));
  }

  updateResultsLive(event: MatCheckboxChange): void {
    this.draft.update((poll) => this.applyCacicElectionRules({
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
}
