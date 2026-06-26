export type FormElementType =
  | 'section'
  | 'statement'
  | 'shortText'
  | 'longText'
  | 'singleChoice'
  | 'multipleChoice'
  | 'singleSelectionGrid'
  | 'multipleSelectionGrid'
  | 'selectionDropdown'
  | 'linearScale'
  | 'starRating'
  | 'date'
  | 'time'
  | 'scheduling';

export const FORM_ELEMENT_TYPES = [
  'section',
  'statement',
  'shortText',
  'longText',
  'singleChoice',
  'multipleChoice',
  'singleSelectionGrid',
  'multipleSelectionGrid',
  'selectionDropdown',
  'linearScale',
  'starRating',
  'date',
  'time',
  'scheduling',
] as const satisfies readonly FormElementType[];

export type FormChoiceOption = {
  id: string;
  label: string;
  description?: string;
};

export type FormGridSettings = {
  rows: FormChoiceOption[];
  columns: FormChoiceOption[];
};

export type FormLinearScaleSettings = {
  min: 0 | 1;
  max: number;
  minLabel?: string;
  maxLabel?: string;
};

export type FormStarRatingSettings = {
  max: number;
};

export type FormSchedulingInviteeMode = 'none' | 'optional' | 'required';

export const FORM_SCHEDULING_INVITEE_MODES = ['none', 'optional', 'required'] as const satisfies readonly FormSchedulingInviteeMode[];

export type FormSchedulingAvailabilityWindow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type FormSchedulingSettings = {
  hostName?: string;
  location?: string;
  timezone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  inviteeMode: FormSchedulingInviteeMode;
  maxInvitees: number;
  availability: FormSchedulingAvailabilityWindow[];
};

export type FormElementSettings = {
  grid?: FormGridSettings;
  linearScale?: FormLinearScaleSettings;
  starRating?: FormStarRatingSettings;
  scheduling?: FormSchedulingSettings;
};

export type FormImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  altText?: string;
  caption?: string;
};

export type FormImageReference = {
  id: string;
  altText?: string;
  caption?: string;
};

export type FormElement = {
  id: string;
  type: FormElementType;
  title: string;
  description?: string;
  descriptionImages?: FormImage[];
  required: boolean;
  options: FormChoiceOption[];
  settings?: FormElementSettings;
};

export type FormSingleSelectionGridAnswer = Record<string, string>;

export type FormMultipleSelectionGridAnswer = Record<string, string[]>;

export type FormSchedulingInvitee = {
  name: string;
  email?: string;
};

export type FormSchedulingAnswer = {
  slotId: string;
  invitees: FormSchedulingInvitee[];
};

export type FormAnswerValue =
  | string
  | number
  | string[]
  | FormSingleSelectionGridAnswer
  | FormMultipleSelectionGridAnswer
  | FormSchedulingAnswer
  | null;

export type FormResponseAnswer = {
  elementId: string;
  value: FormAnswerValue;
};

export type SubmitFormResponseRequest = {
  answers: FormResponseAnswer[];
};

export type FormResponse = {
  id: string;
  formId: string;
  answers: FormResponseAnswer[];
  submittedAt?: string;
};

export function isFormElementType(value: unknown): value is FormElementType {
  return typeof value === 'string' && (FORM_ELEMENT_TYPES as readonly string[]).includes(value);
}

export function isFormAnswerElementType(type: FormElementType): boolean {
  return !['section', 'statement'].includes(type);
}

export function normalizeFormTextValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeFormStringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : null;
}

export function normalizeFormNumberValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

export function normalizeFormResponseAnswers(answers: readonly FormResponseAnswer[]): FormResponseAnswer[] {
  const normalized = new Map<string, FormAnswerValue>();

  for (const answer of answers) {
    const elementId = answer.elementId.trim();
    if (elementId.length > 0) {
      normalized.set(elementId, answer.value);
    }
  }

  return [...normalized.entries()].map(([elementId, value]) => ({ elementId, value }));
}
