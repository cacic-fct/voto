import { MatSelectChange } from '@angular/material/select';
import {
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
} from '@org/voting-contracts';
import {
  createSchedulingAvailability,
  ensureSchedulingSettings,
} from './poll-builder-options';
import { PollBuilderDraftElements } from './poll-builder-draft-elements';

export abstract class PollBuilderDraftScheduling extends PollBuilderDraftElements {
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
}
