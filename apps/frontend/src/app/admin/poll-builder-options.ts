import {
  CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionPhase,
  Poll,
  PollChoiceOption,
  PollElement,
  PollElementSettings,
  PollElementType,
  PollGridSettings,
  PollImage,
  PollImageReference,
  PollMode,
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
} from '@org/voting-contracts';

export type ElementTypeOption = {
  type: PollElementType;
  label: string;
  icon: string;
};

export type GridAxis = keyof PollGridSettings;

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

export const SCALE_MINIMUM_OPTIONS = [0, 1] as const;
export const SCALE_MAXIMUM_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const STAR_RATING_MAXIMUM_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export const SCHEDULING_DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120] as const;
export const SCHEDULING_SLOT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;
export const SCHEDULING_BUFFER_OPTIONS = [0, 5, 10, 15, 30, 45, 60] as const;
export const SCHEDULING_INVITEE_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 10, 15, 20] as const;
export const SCHEDULING_INVITEE_MODE_OPTIONS: { mode: PollSchedulingInviteeMode; label: string }[] = [
  { mode: 'none', label: 'Não coletar convidados' },
  { mode: 'optional', label: 'Convidados opcionais' },
  { mode: 'required', label: 'Exigir pelo menos um convidado' },
];
export const POLL_MODE_OPTIONS: { mode: PollMode; label: string }[] = [
  { mode: 'regular', label: 'Votação regular' },
  { mode: 'cacicElection', label: 'Eleições do CACiC' },
];
export const CACIC_ELECTION_PHASE_OPTIONS: { phase: CacicElectionPhase; label: string }[] = [
  { phase: 'slateSubmission', label: 'Submissão de chapas' },
  { phase: 'election', label: 'Eleição' },
];

export function isOptionChoiceElement(type: PollElementType): boolean {
  return type === 'singleChoice' || type === 'multipleChoice' || type === 'selectionDropdown';
}

export function isGridElement(type: PollElementType): boolean {
  return type === 'singleSelectionGrid' || type === 'multipleSelectionGrid';
}

export function isAnswerElement(type: PollElementType): boolean {
  return type !== 'section' && type !== 'statement';
}

export function elementTypeOption(type: PollElementType): ElementTypeOption {
  return ELEMENT_TYPE_OPTIONS.find((option) => option.type === type) ?? { type, label: type, icon: 'help' };
}

export function elementTypeLabel(type: PollElementType): string {
  return elementTypeOption(type).label;
}

export function createBlankPoll(): Poll {
  return {
    id: '',
    title: '',
    description: '',
    descriptionImages: [],
    status: 'draft',
    mode: 'regular',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    visibleFrom: undefined,
    votingStartsAt: undefined,
    votingEndsAt: undefined,
    elements: [],
    createdAt: '',
    updatedAt: '',
  };
}

export function isCacicElectionGeneratedElementId(elementId: string): boolean {
  return elementId === CACIC_ELECTION_SLATE_FORM_ELEMENT_ID || elementId === CACIC_ELECTION_VOTE_ELEMENT_ID;
}

export function isCacicElectionGeneratedElement(element: PollElement): boolean {
  return isCacicElectionGeneratedElementId(element.id);
}

export function generatedCacicElectionElementFields(element: PollElement): string[] {
  if (element.id === CACIC_ELECTION_SLATE_FORM_ELEMENT_ID) {
    return [
      'Nome da chapa',
      'Nome completo do integrante',
      'Matrícula',
      'Cargo',
      'CPF, telefone ou e-mail',
      'Representante da chapa',
      'Compromissos obrigatórios',
    ];
  }

  if (element.id === CACIC_ELECTION_VOTE_ELEMENT_ID) {
    return [
      'Chapas aprovadas e habilitadas',
      'Integrantes com ano de ingresso',
      'Opção Branco',
      'Opção Nulo',
    ];
  }

  return [];
}

export function createCacicElectionSlateFormPreviewElement(): PollElement {
  return {
    id: CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
    type: 'statement',
    title: 'Submissão de chapa',
    description: 'Formulário gerado automaticamente para coletar dados da chapa e de seus integrantes.',
    required: false,
    options: [],
  };
}

export function createCacicElectionVotePreviewElement(): PollElement {
  return {
    id: CACIC_ELECTION_VOTE_ELEMENT_ID,
    type: 'singleChoice',
    title: 'Voto para chapa',
    description: 'As opções serão geradas automaticamente com as chapas aprovadas e habilitadas.',
    required: true,
    options: [
      {
        id: 'preview-approved-slates',
        label: 'Chapas aprovadas',
        description: 'Substituído pelas chapas habilitadas no momento da eleição.',
      },
      {
        id: 'cacic-election-blank',
        label: 'Branco',
        description: 'Votar em branco.',
      },
      {
        id: 'cacic-election-null',
        label: 'Nulo',
        description: 'Anular o voto.',
      },
    ],
  };
}

export function ensureCacicElectionGeneratedElement(
  elements: readonly PollElement[],
  generatedElement: PollElement,
): PollElement[] {
  const generatedIds = new Set([CACIC_ELECTION_SLATE_FORM_ELEMENT_ID, CACIC_ELECTION_VOTE_ELEMENT_ID]);
  const customElements = elements.filter((element) => !generatedIds.has(element.id));
  return [generatedElement, ...customElements];
}

export function createElement(type: PollElementType): PollElement {
  return {
    id: createId('element'),
    type,
    title: elementTypeLabel(type),
    description: '',
    descriptionImages: [],
    required: isAnswerElement(type),
    options: isOptionChoiceElement(type) ? [createOption(1), createOption(2)] : [],
    settings: createSettingsForType(type),
  };
}

export function createOption(position: number): PollChoiceOption {
  return {
    id: createId('option'),
    label: `Opção ${position}`,
    description: '',
  };
}

export function createSchedulingAvailability(
  position: number,
  dayOffset = 0,
  date = defaultAvailabilityDate(dayOffset),
): PollSchedulingSettings['availability'][number] {
  return {
    id: createId('availability'),
    date,
    startTime: position % 2 === 0 ? '14:00' : '09:00',
    endTime: position % 2 === 0 ? '17:00' : '12:00',
  };
}

export function ensureChoiceOptions(options: PollChoiceOption[]): PollChoiceOption[] {
  return options.length >= 2 ? options : [createOption(1), createOption(2)];
}

export function createSettingsForType(
  type: PollElementType,
  current?: PollElementSettings,
): PollElementSettings | undefined {
  if (isGridElement(type)) {
    return {
      grid: ensureGridSettings(current?.grid),
    };
  }

  if (type === 'linearScale') {
    return {
      linearScale: ensureLinearScaleSettings(current?.linearScale),
    };
  }

  if (type === 'starRating') {
    return {
      starRating: ensureStarRatingSettings(current?.starRating),
    };
  }

  if (type === 'scheduling') {
    return {
      scheduling: ensureSchedulingSettings(current?.scheduling),
    };
  }

  return undefined;
}

export function ensureGridSettings(grid?: PollGridSettings): PollGridSettings {
  return {
    rows: grid?.rows.length ? grid.rows : [createOption(1), createOption(2)],
    columns: grid?.columns.length ? grid.columns : [createOption(1), createOption(2)],
  };
}

export function ensureLinearScaleSettings(
  settings?: PollElementSettings['linearScale'],
): NonNullable<PollElementSettings['linearScale']> {
  const min = settings?.min === 0 ? 0 : 1;
  const max = Math.min(Math.max(settings?.max ?? 5, min + 1), 10);
  return {
    min,
    max,
    minLabel: settings?.minLabel ?? '',
    maxLabel: settings?.maxLabel ?? '',
  };
}

export function ensureStarRatingSettings(
  settings?: PollElementSettings['starRating'],
): NonNullable<PollElementSettings['starRating']> {
  return {
    max: Math.min(Math.max(settings?.max ?? 5, 3), 10),
  };
}

export function ensureSchedulingSettings(settings?: PollElementSettings['scheduling']): PollSchedulingSettings {
  const inviteeMode = settings?.inviteeMode ?? 'optional';
  return {
    hostName: settings?.hostName ?? '',
    location: settings?.location ?? '',
    timezone: settings?.timezone ?? 'America/Sao_Paulo',
    durationMinutes: clampSchedulingOption(settings?.durationMinutes, SCHEDULING_DURATION_OPTIONS, 30),
    slotIntervalMinutes: clampSchedulingOption(settings?.slotIntervalMinutes, SCHEDULING_SLOT_INTERVAL_OPTIONS, 30),
    bufferBeforeMinutes: clampSchedulingOption(settings?.bufferBeforeMinutes, SCHEDULING_BUFFER_OPTIONS, 0),
    bufferAfterMinutes: clampSchedulingOption(settings?.bufferAfterMinutes, SCHEDULING_BUFFER_OPTIONS, 0),
    inviteeMode,
    maxInvitees:
      inviteeMode === 'none'
        ? 0
        : clampSchedulingOption(settings?.maxInvitees, SCHEDULING_INVITEE_LIMIT_OPTIONS, 3),
    availability: settings?.availability.length
      ? settings.availability
      : [createSchedulingAvailability(1), createSchedulingAvailability(2, 1)],
  };
}

export function createSchedulingTimezoneOptions(): string[] {
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

export function toImageReferences(images: readonly PollImage[] | undefined): PollImageReference[] | undefined {
  if (!images?.length) {
    return undefined;
  }

  return images.map((image) => ({
    id: image.id,
    ...(image.altText?.trim() ? { altText: image.altText.trim() } : {}),
    ...(image.caption?.trim() ? { caption: image.caption.trim() } : {}),
  }));
}

function clampSchedulingOption<T extends number>(value: number | undefined, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function defaultAvailabilityDate(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
