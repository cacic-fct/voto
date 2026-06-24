import type { EventManagerVotingEvent } from '@cacic-fct/event-manager-m2m-contracts';

export const VOTING_ADMIN_PERMISSIONS = [
  'poll#read',
  'poll#create',
  'poll#edit',
  'poll#delete',
  'poll#publish',
] as const;

export type VotingAdminPermission = (typeof VOTING_ADMIN_PERMISSIONS)[number];

export type AuthenticatedUser = {
  sub?: string;
  preferredUsername?: string;
  email?: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  oidcScopes: string[];
  claims: Record<string, unknown>;
};

export type AuthRefreshResult = {
  expiresAt: number;
  sessionExpiresAt?: number;
};

export type LoginOptions = {
  returnTo?: string;
  prompt?: string;
};

export type PermissionEvaluationRequest = {
  permissions: string[];
};

export type PermissionEvaluationResponse = {
  permissions: string[];
};

export type PollStatus = 'draft' | 'published' | 'closed';

export const POLL_STATUSES = ['draft', 'published', 'closed'] as const;

export type PollVotingStyle = 'public' | 'partiallySecret' | 'secret' | 'anonymous';

export const POLL_VOTING_STYLES = ['public', 'partiallySecret', 'secret', 'anonymous'] as const;

export type PollVoterEligibilitySource =
  | 'authenticatedUsers'
  | 'unespUsers'
  | 'computerScienceStudents'
  | 'eventAttendance'
  | 'eventAttendanceUnespUsers'
  | 'eventAttendanceComputerScienceStudents'
  | 'enrollmentList';

export const POLL_VOTER_ELIGIBILITY_SOURCES = [
  'authenticatedUsers',
  'unespUsers',
  'computerScienceStudents',
  'eventAttendance',
  'eventAttendanceUnespUsers',
  'eventAttendanceComputerScienceStudents',
  'enrollmentList',
] as const;

export type PollElementType =
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

export const POLL_ELEMENT_TYPES = [
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
] as const;

export type PollChoiceOption = {
  id: string;
  label: string;
  description?: string;
};

export type PollGridSettings = {
  rows: PollChoiceOption[];
  columns: PollChoiceOption[];
};

export type PollLinearScaleSettings = {
  min: 0 | 1;
  max: number;
  minLabel?: string;
  maxLabel?: string;
};

export type PollStarRatingSettings = {
  max: number;
};

export type PollSchedulingInviteeMode = 'none' | 'optional' | 'required';

export const POLL_SCHEDULING_INVITEE_MODES = ['none', 'optional', 'required'] as const;

export type PollSchedulingAvailabilityWindow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type PollSchedulingSettings = {
  hostName?: string;
  location?: string;
  timezone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  inviteeMode: PollSchedulingInviteeMode;
  maxInvitees: number;
  availability: PollSchedulingAvailabilityWindow[];
};

export type PollElementSettings = {
  grid?: PollGridSettings;
  linearScale?: PollLinearScaleSettings;
  starRating?: PollStarRatingSettings;
  scheduling?: PollSchedulingSettings;
};

export type PollImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  altText?: string;
  caption?: string;
};

export type PollImageReference = {
  id: string;
  altText?: string;
  caption?: string;
};

export type PollElement = {
  id: string;
  type: PollElementType;
  title: string;
  description?: string;
  descriptionImages?: PollImage[];
  required: boolean;
  options: PollChoiceOption[];
  settings?: PollElementSettings;
};

export type EventManagerEvent = EventManagerVotingEvent;

export type PollLinkedEvent = Pick<EventManagerEvent, 'id' | 'name' | 'startDate' | 'endDate' | 'locationDescription'>;

export type Poll = {
  id: string;
  title: string;
  description?: string;
  status: PollStatus;
  votingStyle: PollVotingStyle;
  voterEligibilitySource: PollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  directLinkEnabled: boolean;
  directLinkToken?: string;
  resultsPublic: boolean;
  resultsLive: boolean;
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
  linkedEvent?: PollLinkedEvent;
  descriptionImages?: PollImage[];
  elements: PollElement[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type PollSummary = Pick<
  Poll,
  | 'id'
  | 'title'
  | 'description'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'publishedAt'
  | 'linkedEvent'
  | 'votingStyle'
  | 'voterEligibilitySource'
  | 'requireVerifiedUnespRole'
  | 'directLinkEnabled'
  | 'resultsPublic'
  | 'resultsLive'
  | 'allowResponseEditing'
  | 'allowMultipleResponses'
> & {
  elementCount: number;
  responseCount: number;
};

export type SavePollRequest = {
  title: string;
  description?: string;
  descriptionImages?: PollImageReference[];
  status?: PollStatus;
  votingStyle?: PollVotingStyle;
  voterEligibilitySource?: PollVoterEligibilitySource;
  requireVerifiedUnespRole?: boolean;
  directLinkEnabled?: boolean;
  resultsPublic?: boolean;
  resultsLive?: boolean;
  allowResponseEditing?: boolean;
  allowMultipleResponses?: boolean;
  linkedEventId?: string;
  elements: (Omit<PollElement, 'descriptionImages'> & {
    descriptionImages?: PollImageReference[];
  })[];
};

export type PollSingleSelectionGridAnswer = Record<string, string>;

export type PollMultipleSelectionGridAnswer = Record<string, string[]>;

export type PollSchedulingInvitee = {
  name: string;
  email?: string;
};

export type PollSchedulingAnswer = {
  slotId: string;
  invitees: PollSchedulingInvitee[];
};

export type PollAnswerValue =
  | string
  | number
  | string[]
  | PollSingleSelectionGridAnswer
  | PollMultipleSelectionGridAnswer
  | PollSchedulingAnswer
  | null;

export type PollResponseAnswer = {
  elementId: string;
  value: PollAnswerValue;
};

export type SubmitPollResponseRequest = {
  answers: PollResponseAnswer[];
};

export type PollResponse = {
  id: string;
  pollId: string;
  answers: PollResponseAnswer[];
  submittedAt?: string;
};

export type PollUserResponseState = {
  hasSubmitted: boolean;
  canEdit: boolean;
  canSubmitAnother: boolean;
  response?: PollResponse;
};

export type PollResultsVoter = {
  userId: string;
  name?: string;
  preferredUsername?: string;
  email?: string;
  unespRole?: string;
  enrollmentNumber?: string;
};

export type PollResultsResponse = {
  id: string;
  submittedAt?: string;
  voter?: PollResultsVoter;
  answers: PollResponseAnswer[];
};

export type PollResults = {
  pollId: string;
  anonymous: boolean;
  responseCount: number;
  responses: PollResultsResponse[];
};

export type PollResultsDelta = {
  pollId: string;
  responseCount: number;
  responses: PollResultsResponse[];
};

export type PollEligibilityImportFormat = 'csv' | 'txt';

export const POLL_ELIGIBILITY_IMPORT_FORMATS = ['csv', 'txt'] as const;

export type PollEligibilityMutationMode = 'append' | 'replace';

export const POLL_ELIGIBILITY_MUTATION_MODES = ['append', 'replace'] as const;

export type EventManagerPerson = {
  enrollmentNumber: string;
  name: string;
  email?: string | null;
};

export type PollEligibilityEnrollment = {
  pollId: string;
  enrollmentNumber: string;
  createdAt: string;
  people: EventManagerPerson[];
};

export type PollEligibilityEnrollmentList = {
  entries: PollEligibilityEnrollment[];
  totalCount: number;
};

export type AddPollEligibilityEnrollmentsRequest = {
  enrollmentNumbers: string[];
};

export type ImportPollEligibilityEnrollmentsRequest = {
  format: PollEligibilityImportFormat;
  content: string;
  mode?: PollEligibilityMutationMode;
  selectedHeader?: string;
  fileName?: string;
};

export type PollEligibilityEnrollmentImportResult = PollEligibilityEnrollmentList & {
  createdCount: number;
  duplicateCount: number;
  existingCount: number;
  invalidCount: number;
  replacedCount: number;
};

export function normalizePermissions(permissions: readonly string[]): string[] {
  return [...new Set(permissions.map((permission) => permission.trim()).filter(Boolean))];
}

export function hasVotingAdminPermission(permissions: readonly string[], roles: readonly string[] = []): boolean {
  if (roles.some((role) => ['admin', 'administrator', 'voting-admin'].includes(role))) {
    return true;
  }

  const granted = new Set(normalizePermissions(permissions));
  return VOTING_ADMIN_PERMISSIONS.some((permission) => granted.has(permission));
}
