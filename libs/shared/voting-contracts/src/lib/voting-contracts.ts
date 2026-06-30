import type { EventManagerVotingEvent } from '@cacic-fct/event-manager-m2m-contracts';
import type {
  FormAnswerValue,
  FormChoiceOption,
  FormElement,
  FormElementSettings,
  FormElementType,
  FormGridSettings,
  FormImage,
  FormImageReference,
  FormLinearScaleSettings,
  FormMultipleSelectionGridAnswer,
  FormResponseAnswer,
  FormSchedulingAnswer,
  FormSchedulingAvailabilityWindow,
  FormSchedulingInvitee,
  FormSchedulingInviteeMode,
  FormSchedulingSettings,
  FormSingleSelectionGridAnswer,
  FormStarRatingSettings,
  SubmitFormResponseRequest,
} from '@cacic-fct/form-contracts';
import { FORM_ELEMENT_TYPES, FORM_SCHEDULING_INVITEE_MODES } from '@cacic-fct/form-contracts';

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

export type PollElementType = FormElementType;

export const POLL_ELEMENT_TYPES = FORM_ELEMENT_TYPES;

export type PollChoiceOption = FormChoiceOption;

export type PollGridSettings = FormGridSettings;

export type PollLinearScaleSettings = FormLinearScaleSettings;

export type PollStarRatingSettings = FormStarRatingSettings;

export type PollSchedulingInviteeMode = FormSchedulingInviteeMode;

export const POLL_SCHEDULING_INVITEE_MODES = FORM_SCHEDULING_INVITEE_MODES;

export type PollSchedulingAvailabilityWindow = FormSchedulingAvailabilityWindow;

export type PollSchedulingSettings = FormSchedulingSettings;

export type PollElementSettings = FormElementSettings;

export type PollImage = FormImage;

export type PollImageReference = FormImageReference;

export type PollElement = FormElement;

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

export type PollSingleSelectionGridAnswer = FormSingleSelectionGridAnswer;

export type PollMultipleSelectionGridAnswer = FormMultipleSelectionGridAnswer;

export type PollSchedulingInvitee = FormSchedulingInvitee;

export type PollSchedulingAnswer = FormSchedulingAnswer;

export type PollAnswerValue = FormAnswerValue;

export type PollResponseAnswer = FormResponseAnswer & {
  element?: PollElement;
};

export type SubmitPollResponseRequest = SubmitFormResponseRequest;

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

export function hasVotingAdminRole(roles: readonly string[] = []): boolean {
  return roles.some((role) => ['admin', 'administrator', 'voting-admin'].includes(role));
}

export function hasVotingAdminPermission(permissions: readonly string[], roles: readonly string[] = []): boolean {
  if (hasVotingAdminRole(roles)) {
    return true;
  }

  const granted = new Set(normalizePermissions(permissions));
  return VOTING_ADMIN_PERMISSIONS.some((permission) => granted.has(permission));
}
