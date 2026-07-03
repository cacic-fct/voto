import {
  PollElement,
  PollSchedulingAnswer,
  PollSchedulingInvitee,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import {
  setSchedulingInviteeAnswer,
  setSchedulingSlotAnswer,
} from './poll-vote-answer-state';
import { PollVotePageAnswers } from './poll-vote-page-answers';
import {
  SchedulingSlotGroup,
  SchedulingSlotView,
  readSchedulingAnswer,
  schedulingInviteeIndexes,
  schedulingInviteeLabel,
  schedulingSlotGroups,
  schedulingSlots,
} from './poll-vote-scheduling';

export abstract class PollVotePageScheduling extends PollVotePageAnswers {
  protected schedulingSlots(element: PollElement): SchedulingSlotView[] {
    return schedulingSlots(element);
  }

  protected schedulingSlotGroups(element: PollElement): SchedulingSlotGroup[] {
    return schedulingSlotGroups(element);
  }

  protected setSchedulingSlot(elementId: string, slotId: string): void {
    this.answers.update((answers) =>
      setSchedulingSlotAnswer(answers, elementId, slotId),
    );
  }

  protected setSchedulingInvitee(
    elementId: string,
    index: number,
    field: keyof PollSchedulingInvitee,
    event: Event,
  ): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? target.value : '';
    this.answers.update((answers) =>
      setSchedulingInviteeAnswer(answers, elementId, index, field, value),
    );
  }

  protected isSchedulingSlotSelected(
    elementId: string,
    slotId: string,
  ): boolean {
    return (
      this.readSchedulingAnswer(this.answers()[elementId]).slotId === slotId
    );
  }

  protected schedulingInviteeIndexes(element: PollElement): number[] {
    return schedulingInviteeIndexes(element);
  }

  protected schedulingInviteeValue(
    elementId: string,
    index: number,
    field: keyof PollSchedulingInvitee,
  ): string {
    return (
      this.readSchedulingAnswer(this.answers()[elementId]).invitees[index]?.[
        field
      ] ?? ''
    );
  }

  protected schedulingInviteeLabel(settings: PollSchedulingSettings): string {
    return schedulingInviteeLabel(settings);
  }

  private readSchedulingAnswer(value: unknown): PollSchedulingAnswer {
    return readSchedulingAnswer(value);
  }
}
