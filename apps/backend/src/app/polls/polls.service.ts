import { Injectable, MessageEvent, Optional } from '@nestjs/common';
import {
  AdminCacicElectionSlate,
  CacicElectionSlate,
  EventManagerEvent,
  Poll,
  PollElement,
  PollElementSettings,
  PollElementType,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollResponse,
  PollResponseAnswer,
  PollResults,
  PollResultsVoter,
  PollSchedulingSettings,
  PollStatus,
  PollSummary,
  PollUserResponseState,
  PollVoterEligibilitySource,
  PollVotingStyle,
} from '@org/voting-contracts';
import {
  PollElementType as DbPollElementType,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';
import { Observable } from 'rxjs';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddPollEligibilityEnrollmentsDto,
  ImportPollEligibilityEnrollmentsDto,
  RejectCacicElectionSlateDto,
  SavePollDto,
  SubmitCacicElectionSlateDto,
  SubmitPollResponseDto,
  UpdateCacicElectionSlateDto,
  UpdateCacicElectionSlateEnabledDto,
} from './dto/poll.dto';
import { PollCacicElectionService } from './poll-cacic-election.service';
import {
  cleanOptionalText,
  parseEventDate,
  readElementSettings,
  toContractElement,
  toContractElementType,
  toContractPoll,
  toContractStatus,
  toContractVoterEligibilitySource,
  toContractVotingStyle,
  toDbElementType,
  toDbStatus,
  toDbVoterEligibilitySource,
  toDbVotingStyle,
} from './poll-contract.mapper';
import { PollEligibilityService } from './poll-eligibility.service';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollImagesService } from './poll-images.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import { PollMutationsService } from './poll-mutations.service';
import { PollQueryService } from './poll-query.service';
import {
  ElementRecord,
  ParsedEligibilityEnrollments,
  PollContractOptions,
  PollEligibilityRecord,
  PollMetadataData,
  PollPublicationScheduleData,
  PollResponseOptionsData,
  PollResultStreamEvent,
  PollResultVisibilityData,
} from './poll-records';
import { PollResponsesService } from './poll-responses.service';
import {
  buildSchedulingSlots,
  ensureRequiredGridRows,
  isEmptyAnswer,
  normalizeAnswer,
  validatePollResponse,
} from './poll-response.validator';
import { PollResultsService } from './poll-results.service';
import { parseStringList, toPollResultsVoter } from './poll-user-claims';

@Injectable()
export class PollsService {
  private readonly eligibility: PollEligibilityService;
  private readonly mutations: PollMutationsService;
  private readonly query: PollQueryService;
  private readonly responses: PollResponsesService;
  private readonly results: PollResultsService;
  private readonly cacicElection: PollCacicElectionService;

  constructor(
    prisma: PrismaService,
    eventManager: EventManagerIntegrationService,
    accountManager: AccountManagerIntegrationService,
    pollImages?: PollImagesService,
    @Optional()
    featureFlags?: FeatureFlagService,
    @Optional()
    pollEligibility?: PollEligibilityService,
    @Optional()
    pollMutationOptions?: PollMutationOptionsService,
    @Optional()
    pollMutationValidation?: PollMutationValidationService,
    @Optional()
    pollElementMutations?: PollElementMutationsService,
    @Optional()
    pollImageMutations?: PollImageMutationsService,
    @Optional()
    pollCacicElection?: PollCacicElectionService,
    @Optional()
    pollMutations?: PollMutationsService,
    @Optional()
    pollQuery?: PollQueryService,
    @Optional()
    pollResults?: PollResultsService,
    @Optional()
    pollResponses?: PollResponsesService,
  ) {
    const mutationValidation = pollMutationValidation ?? new PollMutationValidationService();
    const mutationOptions = pollMutationOptions ?? new PollMutationOptionsService(eventManager);
    const elementMutations = pollElementMutations ?? new PollElementMutationsService(mutationOptions);
    const imageMutations = pollImageMutations ?? new PollImageMutationsService(mutationValidation);

    this.eligibility =
      pollEligibility ?? new PollEligibilityService(prisma, eventManager, featureFlags, accountManager);
    this.cacicElection = pollCacicElection ?? new PollCacicElectionService(prisma, accountManager);
    this.results = pollResults ?? new PollResultsService(prisma, this.eligibility);
    this.responses = pollResponses ?? new PollResponsesService(prisma, this.eligibility, this.results);
    this.mutations =
      pollMutations ??
      new PollMutationsService(
        prisma,
        eventManager,
        this.cacicElection,
        pollImages,
        mutationValidation,
        mutationOptions,
        elementMutations,
        imageMutations,
      );
    this.query = pollQuery ?? new PollQueryService(prisma, eventManager, this.eligibility);
  }

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.query.listLinkableEvents();
  }

  listAdminPolls(): Promise<PollSummary[]> {
    return this.query.listAdminPolls();
  }

  listPublicPolls(): Promise<PollSummary[]> {
    return this.query.listPublicPolls();
  }

  getAdminPoll(id: string): Promise<Poll> {
    return this.query.getAdminPoll(id);
  }

  getPublishedPoll(id: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    return this.query.getPublishedPoll(id, user);
  }

  getPublishedPollByDirectLink(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    return this.query.getPublishedPollByDirectLink(directLinkToken, user);
  }

  assertPublishedPollReadable(id: string, user?: AuthenticatedPrincipal): Promise<void> {
    return this.query.assertPublishedPollReadable(id, user);
  }

  assertPublishedDirectLinkPollReadable(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<string> {
    return this.query.assertPublishedDirectLinkPollReadable(directLinkToken, user);
  }

  getAdminPollResults(id: string): Promise<PollResults> {
    return this.results.getAdminPollResults(id);
  }

  exportCacicElectionVoterEnrollments(id: string): Promise<string> {
    return this.results.exportCacicElectionVoterEnrollments(id);
  }

  getPublicPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    return this.results.getPublicPollResults(id, user);
  }

  getDirectLinkPublicPollResults(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResults> {
    return this.results.getDirectLinkPublicPollResults(directLinkToken, user);
  }

  streamAdminPollResults(id: string, after: number): Observable<MessageEvent> {
    return this.results.streamAdminPollResults(id, after);
  }

  streamPublicPollResults(id: string, after: number, user?: AuthenticatedPrincipal): Observable<MessageEvent> {
    return this.results.streamPublicPollResults(id, after, user);
  }

  streamDirectLinkPublicPollResults(
    directLinkToken: string,
    after: number,
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return this.results.streamDirectLinkPublicPollResults(directLinkToken, after, user);
  }

  createPoll(input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    return this.mutations.createPoll(input, user);
  }

  updatePoll(id: string, input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    return this.mutations.updatePoll(id, input, user);
  }

  updatePollStatus(id: string, status: PollStatus, user: AuthenticatedPrincipal): Promise<Poll> {
    return this.mutations.updatePollStatus(id, status, user);
  }

  deletePoll(id: string): Promise<void> {
    return this.mutations.deletePoll(id);
  }

  listEligibilityEnrollments(pollId: string): Promise<PollEligibilityEnrollmentList> {
    return this.eligibility.listEligibilityEnrollments(pollId);
  }

  addEligibilityEnrollments(
    pollId: string,
    input: AddPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    return this.eligibility.addEligibilityEnrollments(pollId, input, user);
  }

  importEligibilityEnrollments(
    pollId: string,
    input: ImportPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    return this.eligibility.importEligibilityEnrollments(pollId, input, user);
  }

  deleteEligibilityEnrollment(pollId: string, enrollmentNumber: string): Promise<void> {
    return this.eligibility.deleteEligibilityEnrollment(pollId, enrollmentNumber);
  }

  clearEligibilityEnrollments(pollId: string): Promise<PollEligibilityEnrollmentList> {
    return this.eligibility.clearEligibilityEnrollments(pollId);
  }

  listPublicCacicElectionSlates(pollId: string, user?: AuthenticatedPrincipal): Promise<CacicElectionSlate[]> {
    return this.cacicElection.listPublicCacicElectionSlates(pollId, user);
  }

  getMyCacicElectionSlate(
    pollId: string,
    user?: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate | null> {
    return this.cacicElection.getMyCacicElectionSlate(pollId, user);
  }

  submitCacicElectionSlate(
    pollId: string,
    input: SubmitCacicElectionSlateDto,
    user?: AuthenticatedPrincipal,
  ): Promise<CacicElectionSlate> {
    return this.cacicElection.submitCacicElectionSlate(pollId, input, user);
  }

  listAdminCacicElectionSlates(pollId: string): Promise<AdminCacicElectionSlate[]> {
    return this.cacicElection.listAdminCacicElectionSlates(pollId);
  }

  createAdminCacicElectionSlate(
    pollId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    return this.cacicElection.createAdminCacicElectionSlate(pollId, input, user);
  }

  updateAdminCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    return this.cacicElection.updateAdminCacicElectionSlate(pollId, slateId, input, user);
  }

  rejectCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: RejectCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    return this.cacicElection.rejectCacicElectionSlate(pollId, slateId, input, user);
  }

  updateCacicElectionSlateEnabled(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateEnabledDto,
  ): Promise<AdminCacicElectionSlate> {
    return this.cacicElection.updateCacicElectionSlateEnabled(pollId, slateId, input);
  }

  deleteCacicElectionSlate(pollId: string, slateId: string): Promise<void> {
    return this.cacicElection.deleteCacicElectionSlate(pollId, slateId);
  }

  submitResponse(id: string, input: SubmitPollResponseDto, user?: AuthenticatedPrincipal): Promise<PollResponse> {
    return this.responses.submitResponse(id, input, user);
  }

  submitDirectLinkResponse(
    directLinkToken: string,
    input: SubmitPollResponseDto,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResponse> {
    return this.responses.submitDirectLinkResponse(directLinkToken, input, user);
  }

  getUserResponseState(id: string, user?: AuthenticatedPrincipal): Promise<PollUserResponseState> {
    return this.responses.getUserResponseState(id, user);
  }

  getDirectLinkUserResponseState(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollUserResponseState> {
    return this.responses.getDirectLinkUserResponseState(directLinkToken, user);
  }

  private get resultSubscribers(): Map<string, Set<(event: PollResultStreamEvent) => void>> {
    return this.results.resultSubscribers;
  }

  private validatePollInput(input: SavePollDto): void {
    return this.mutations.validatePollInput(input);
  }

  private validatePollPublicationSchedule(schedule: PollPublicationScheduleData): void {
    return this.mutations.validatePollPublicationSchedule(schedule);
  }

  private normalizeElementSettings(element: SavePollDto['elements'][number]): PollElementSettings | undefined {
    return this.mutations.normalizeElementSettings(element);
  }

  private resolvePollMetadata(input: SavePollDto, existing?: PollMetadataData): Promise<PollMetadataData> {
    return this.mutations.resolvePollMetadata(input, existing);
  }

  private resolvePollResultVisibility(
    input: SavePollDto,
    existing?: PollResultVisibilityData,
    metadata?: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase'>,
  ): PollResultVisibilityData {
    return this.mutations.resolvePollResultVisibility(input, existing, metadata);
  }

  private resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    metadata: Pick<PollMetadataData, 'mode' | 'cacicElectionPhase' | 'votingStyle'>,
  ): PollResponseOptionsData {
    return this.mutations.resolvePollResponseOptions(input, existing, metadata);
  }

  private resolvePollPublicationSchedule(
    input: SavePollDto,
    existing?: PollPublicationScheduleData,
  ): PollPublicationScheduleData {
    return this.mutations.resolvePollPublicationSchedule(input, existing);
  }

  private parseEligibilityImport(input: ImportPollEligibilityEnrollmentsDto): ParsedEligibilityEnrollments {
    return this.eligibility.parseEligibilityImport(input);
  }

  private normalizeEnrollmentNumbers(rawValues: readonly unknown[]): ParsedEligibilityEnrollments {
    return this.eligibility.normalizeEnrollmentNumbers(rawValues);
  }

  private toPollResultsVoter(user: {
    id: string;
    name: string | null;
    preferredUsername: string | null;
    email: string | null;
    claims: unknown;
  }): PollResultsVoter {
    return toPollResultsVoter({ ...user, claims: user.claims as Prisma.JsonValue });
  }

  private ensureVotingAllowed(poll: PollEligibilityRecord, user: AuthenticatedVoter): Promise<void> {
    return this.eligibility.ensureVotingAllowed(poll, user);
  }

  private validateResponse(
    poll: Parameters<typeof validatePollResponse>[0],
    input: SubmitPollResponseDto,
  ): PollResponseAnswer[] {
    return validatePollResponse(poll, input);
  }

  private normalizeAnswer(element: ElementRecord, rawValue: unknown): PollResponseAnswer['value'] {
    return normalizeAnswer(element, rawValue);
  }

  private ensureRequiredGridRows(
    element: Pick<ElementRecord, 'required' | 'title'>,
    rows: Parameters<typeof ensureRequiredGridRows>[1],
    selected: Record<string, string | string[]>,
  ): void {
    return ensureRequiredGridRows(element, rows, selected);
  }

  private isEmptyAnswer(value: unknown): boolean {
    return isEmptyAnswer(value);
  }

  private buildSchedulingSlots(settings: PollSchedulingSettings): { id: string }[] {
    return buildSchedulingSlots(settings);
  }

  private subscribeToPollResults(pollId: string, listener: (event: PollResultStreamEvent) => void): () => void {
    return this.results.subscribeToPollResults(pollId, listener);
  }

  private publishPollResults(event: PollResultStreamEvent): void {
    return this.results.publishPollResults(event);
  }

  private toContractPoll(poll: Parameters<typeof toContractPoll>[0], options: PollContractOptions = {}): Poll {
    return toContractPoll(poll, options);
  }

  private toContractElement(element: ElementRecord): PollElement {
    return toContractElement(element, [], {});
  }

  private toDbStatus(status: string): DbPollStatus {
    return toDbStatus(status as PollStatus);
  }

  private toContractStatus(status: DbPollStatus): PollStatus {
    return toContractStatus(status);
  }

  private toDbVotingStyle(style: string): DbPollVotingStyle {
    return toDbVotingStyle(style as PollVotingStyle);
  }

  private toContractVotingStyle(status: DbPollVotingStyle): PollVotingStyle {
    return toContractVotingStyle(status);
  }

  private toDbVoterEligibilitySource(source: string): DbPollVoterEligibilitySource {
    return toDbVoterEligibilitySource(source as PollVoterEligibilitySource);
  }

  private toContractVoterEligibilitySource(source: DbPollVoterEligibilitySource): PollVoterEligibilitySource {
    return toContractVoterEligibilitySource(source);
  }

  private toDbElementType(type: string): DbPollElementType {
    return toDbElementType(type as PollElementType);
  }

  private toContractElementType(type: DbPollElementType): PollElementType {
    return toContractElementType(type);
  }

  private cleanOptionalText(value?: string): string | undefined {
    return cleanOptionalText(value);
  }

  private parseEventDate(value: string, fieldName: string): Date {
    return parseEventDate(value, fieldName);
  }

  private parseStringList(value: string): string[] {
    return parseStringList(value);
  }

  private readElementSettings(element: ElementRecord): PollElementSettings {
    return readElementSettings(element);
  }
}
