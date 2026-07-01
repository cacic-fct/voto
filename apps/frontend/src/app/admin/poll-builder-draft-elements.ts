import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatSelectChange } from '@angular/material/select';
import {
  POLL_ELEMENT_TYPES,
  PollChoiceOption,
  PollElement,
  PollElementType,
  PollImage,
} from '@org/voting-contracts';
import {
  GridAxis,
  createElement,
  createOption,
  createSettingsForType,
  ensureChoiceOptions,
  ensureGridSettings,
  ensureLinearScaleSettings,
  isAnswerElement,
  isCacicElectionGeneratedElementId,
  isOptionChoiceElement,
} from './poll-builder-options';
import { PollBuilderDraftPollSettings } from './poll-builder-draft-poll-settings';

export abstract class PollBuilderDraftElements extends PollBuilderDraftPollSettings {
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

  updateOptionLabel(elementId: string, optionId: string, event: Event): void {
    this.updateOption(elementId, optionId, (option) => ({ ...option, label: this.readInputValue(event) }));
  }

  updateOptionDescription(elementId: string, optionId: string, event: Event): void {
    this.updateOption(elementId, optionId, (option) => ({ ...option, description: this.readInputValue(event) }));
  }

  protected updateElement(elementId: string, update: (element: PollElement) => PollElement): void {
    if (isCacicElectionGeneratedElementId(elementId)) {
      return;
    }

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
}
