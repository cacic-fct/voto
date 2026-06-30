import { Injectable, MessageEvent, NotFoundException, Optional } from '@nestjs/common';
import {
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
  PollStatus,
  PollSummary,
  PollUserResponseState,
  PollVoterEligibilitySource,
  PollVotingStyle,
} from '@org/voting-contracts';
import { Observable } from 'rxjs';
import {
  PollElementType as DbPollElementType,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddPollEligibilityEnrollmentsDto,
  ImportPollEligibilityEnrollmentsDto,
  SavePollDto,
  SubmitPollResponseDto,
} from './dto/poll.dto';
import { requireAuthenticatedVoter } from './poll-auth';
import {
  cleanOptionalText,
  isComputerScienceEligibilitySource,
  isEventAttendanceEligibilitySource,
  isGridElement,
  isOptionChoiceElement,
  parseEventDate,
  readElementSettings,
  toContractElement,
  toContractElementType,
  toContractLinkedEvent,
  toContractPoll,
  toContractStatus,
  toContractVoterEligibilitySource,
  toContractVotingStyle,
  toDbElementType,
  toDbStatus,
  toDbVoterEligibilitySource,
  toDbVotingStyle,
  toElementSnapshotJson,
} from './poll-contract.mapper';
import { PollEligibilityService } from './poll-eligibility.service';
import { normalizeDirectLinkToken } from './poll-identifiers';
import { PollImagesService } from './poll-images.service';
import { PollMutationsService } from './poll-mutations.service';
import {
  ElementRecord,
  ParsedEligibilityEnrollments,
  PollContractOptions,
  PollEligibilityRecord,
  PollMetadataData,
  PollRecord,
  PollResponseOptionsData,
  PollResultStreamEvent,
  PollResultVisibilityData,
  pollInclude,
} from './poll-records';
import { PollResponsesService } from './poll-responses.service';
import {
  pollResponseInclude,
  toContractPollResponse,
  toContractPollResponseAnswer,
} from './poll-response.mapper';
import { PollResultsService } from './poll-results.service';
import { validatePollResponse } from './poll-response.validator';
import {
  isRecord,
  normalizeEnrollmentNumber,
  parseStringList,
  readBooleanValue,
  readClaimValues,
  readClaimValuesFromClaims,
  readEnrollmentNumberFromClaims,
  readUserEnrollmentNumber,
  toPollResultsVoter,
} from './poll-user-claims';

@Injectable()
export class PollsService {
  private readonly eligibility: PollEligibilityService;
  private readonly mutations: PollMutationsService;
  private readonly responses: PollResponsesService;
  private readonly results: PollResultsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly pollImages?: PollImagesService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
    @Optional()
    pollEligibility?: PollEligibilityService,
    @Optional()
    pollMutations?: PollMutationsService,
    @Optional()
    pollResponses?: PollResponsesService,
    @Optional()
    pollResults?: PollResultsService,
  ) {
    this.eligibility = pollEligibility ?? new PollEligibilityService(prisma, eventManager, featureFlags);
    this.results = pollResults ?? new PollResultsService(prisma, this.eligibility);
    this.mutations = pollMutations ?? new PollMutationsService(prisma, eventManager, pollImages);
    this.responses = pollResponses ?? new PollResponsesService(prisma, this.eligibility, this.results);
  }

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.mutations.listLinkableEvents();
  }

  async listAdminPolls(): Promise<PollSummary[]> {
    const polls = await this.prisma.poll.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: { where: { retiredAt: null } },
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => this.toPollSummary(poll));
  }

  async listPublicPolls(): Promise<PollSummary[]> {
    const polls = await this.prisma.poll.findMany({
      where: {
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: { where: { retiredAt: null } },
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => this.toPollSummary(poll));
  }

  async getAdminPoll(id: string): Promise<Poll> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async getPublishedPoll(id: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
    return toContractPoll(poll);
  }

  async getPublishedPollByDirectLink(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    requireAuthenticatedVoter(user);
    return toContractPoll(poll, { imageDirectLinkToken: normalizedToken });
  }

  async assertPublishedPollReadable(id: string, user?: AuthenticatedPrincipal): Promise<void> {
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      select: {
        id: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    await this.eligibility.ensureVotingAllowed(poll, requireAuthenticatedVoter(user));
  }

  async assertPublishedDirectLinkPollReadable(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<string> {
    const normalizedToken = normalizeDirectLinkToken(directLinkToken);
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        OR: [
          { status: DbPollStatus.PUBLISHED },
          { status: DbPollStatus.CLOSED, resultsPublic: true },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    requireAuthenticatedVoter(user);
    return poll.id;
  }

  getAdminPollResults(id: string): Promise<PollResults> {
    return this.results.getAdminPollResults(id);
  }

  getPublicPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    return this.results.getPublicPollResults(id, user);
  }

  getDirectLinkPublicPollResults(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
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

  private toPollSummary(poll: {
    id: string;
    title: string;
    description: string | null;
    status: DbPollStatus;
    votingStyle: DbPollVotingStyle;
    voterEligibilitySource: DbPollVoterEligibilitySource;
    requireVerifiedUnespRole: boolean;
    directLinkEnabled: boolean;
    resultsPublic: boolean;
    resultsLive: boolean;
    allowResponseEditing: boolean;
    allowMultipleResponses: boolean;
    linkedEventId: string | null;
    linkedEventName: string | null;
    linkedEventStartDate: Date | null;
    linkedEventEndDate: Date | null;
    linkedEventLocationDescription: string | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    _count: {
      elements: number;
      responses: number;
    };
  }): PollSummary {
    return {
      id: poll.id,
      title: poll.title,
      description: poll.description ?? undefined,
      status: toContractStatus(poll.status),
      votingStyle: toContractVotingStyle(poll.votingStyle),
      voterEligibilitySource: toContractVoterEligibilitySource(poll.voterEligibilitySource),
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsLive,
      allowResponseEditing: poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEvent: toContractLinkedEvent(poll),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
      publishedAt: poll.publishedAt?.toISOString(),
      elementCount: poll._count.elements,
      responseCount: poll._count.responses,
    };
  }

  private get resultSubscribers(): Map<string, Set<(event: PollResultStreamEvent) => void>> {
    return this.results.resultSubscribers;
  }

  private validatePollInput(input: SavePollDto): void {
    return this.mutations.validatePollInput(input);
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
  ): PollResultVisibilityData {
    return this.mutations.resolvePollResultVisibility(input, existing);
  }

  private resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    votingStyle: DbPollVotingStyle,
  ): PollResponseOptionsData {
    return this.mutations.resolvePollResponseOptions(input, existing, votingStyle);
  }

  private parseEligibilityImport(input: ImportPollEligibilityEnrollmentsDto): ParsedEligibilityEnrollments {
    return this.eligibility.parseEligibilityImport(input);
  }

  private normalizeEnrollmentNumbers(rawValues: readonly unknown[]): ParsedEligibilityEnrollments {
    return this.eligibility.normalizeEnrollmentNumbers(rawValues);
  }

  private normalizeEnrollmentNumber(rawValue: unknown): string | null {
    return normalizeEnrollmentNumber(rawValue);
  }

  private ensureVotingAllowed(poll: PollEligibilityRecord, user: AuthenticatedVoter): Promise<void> {
    return this.eligibility.ensureVotingAllowed(poll, user);
  }

  private subscribeToPollResults(pollId: string, listener: (event: PollResultStreamEvent) => void): () => void {
    return this.results.subscribeToPollResults(pollId, listener);
  }

  private publishPollResults(event: PollResultStreamEvent): void {
    return this.results.publishPollResults(event);
  }

  private toPollResultsVoter(user: {
    id: string;
    name: string | null;
    preferredUsername: string | null;
    email: string | null;
    claims: Prisma.JsonValue | null;
  }): PollResultsVoter {
    return toPollResultsVoter(user);
  }

  private responseInclude(): Prisma.PollResponseInclude {
    return pollResponseInclude;
  }

  private toContractResponse(response: Parameters<typeof toContractPollResponse>[0]): PollResponse {
    return toContractPollResponse(response);
  }

  private toContractResponseAnswer(answer: Parameters<typeof toContractPollResponseAnswer>[0]): PollResponseAnswer {
    return toContractPollResponseAnswer(answer);
  }

  private validateResponse(poll: PollRecord, input: SubmitPollResponseDto): PollResponseAnswer[] {
    return validatePollResponse(poll, input);
  }

  private requireAuthenticatedVoter(user?: AuthenticatedPrincipal): AuthenticatedVoter {
    return requireAuthenticatedVoter(user);
  }

  private readElementSettings(element: ElementRecord): PollElementSettings {
    return readElementSettings(element);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return isRecord(value);
  }

  private readUserEnrollmentNumber(user: AuthenticatedPrincipal): string | null {
    return readUserEnrollmentNumber(user);
  }

  private readEnrollmentNumberFromClaims(claims: Record<string, unknown>): string | null {
    return readEnrollmentNumberFromClaims(claims);
  }

  private readClaimValues(user: AuthenticatedPrincipal, claimNames: readonly string[]): unknown[] {
    return readClaimValues(user, claimNames);
  }

  private readClaimValuesFromClaims(claims: Record<string, unknown>, claimNames: readonly string[]): unknown[] {
    return readClaimValuesFromClaims(claims, claimNames);
  }

  private parseStringList(value: string): string[] {
    return parseStringList(value);
  }

  private readBooleanValue(value: unknown): boolean {
    return readBooleanValue(value);
  }

  private toContractPoll(poll: PollRecord, options: PollContractOptions = {}): Poll {
    return toContractPoll(poll, options);
  }

  private toContractElement(element: ElementRecord, images: [], options: PollContractOptions): PollElement {
    return toContractElement(element, images, options);
  }

  private toElementSnapshotJson(element: ElementRecord): Prisma.InputJsonValue {
    return toElementSnapshotJson(element);
  }

  private toContractLinkedEvent(poll: {
    linkedEventId: string | null;
    linkedEventName: string | null;
    linkedEventStartDate: Date | null;
    linkedEventEndDate: Date | null;
    linkedEventLocationDescription: string | null;
  }) {
    return toContractLinkedEvent(poll);
  }

  private toDbStatus(status: PollStatus): DbPollStatus {
    return toDbStatus(status);
  }

  private toContractStatus(status: DbPollStatus): PollStatus {
    return toContractStatus(status);
  }

  private toDbVotingStyle(style: PollVotingStyle): DbPollVotingStyle {
    return toDbVotingStyle(style);
  }

  private toContractVotingStyle(style: DbPollVotingStyle): PollVotingStyle {
    return toContractVotingStyle(style);
  }

  private toDbVoterEligibilitySource(source: PollVoterEligibilitySource): DbPollVoterEligibilitySource {
    return toDbVoterEligibilitySource(source);
  }

  private toContractVoterEligibilitySource(source: DbPollVoterEligibilitySource): PollVoterEligibilitySource {
    return toContractVoterEligibilitySource(source);
  }

  private isEventAttendanceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
    return isEventAttendanceEligibilitySource(source);
  }

  private isComputerScienceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
    return isComputerScienceEligibilitySource(source);
  }

  private isOptionChoiceElement(type: PollElementType): boolean {
    return isOptionChoiceElement(type);
  }

  private isGridElement(type: PollElementType): boolean {
    return isGridElement(type);
  }

  private toDbElementType(type: PollElementType): DbPollElementType {
    return toDbElementType(type);
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
}
