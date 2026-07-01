import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountManagerPerson,
  CACIC_ELECTION_BLANK_OPTION_ID,
  CACIC_ELECTION_NULL_OPTION_ID,
  EventManagerEvent,
  AdminCacicElectionSlate,
  CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionPhase,
  CacicElectionSlate,
  CacicElectionSlateMember,
  CacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole,
  CacicElectionSlateStatus,
  Poll,
  PollAnswerValue,
  PollChoiceOption,
  PollElement,
  PollElementSettings,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollEligibilityMutationMode,
  PollElementType,
  PollImage,
  PollImageReference,
  PollLinkedEvent,
  PollResponse,
  PollResponseAnswer,
  PollResults,
  PollResultsDelta,
  PollResultsResponse,
  PollSchedulingAvailabilityWindow,
  PollSchedulingInvitee,
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
  PollResultsVoter,
  PollStatus,
  PollSummary,
  PollUserResponseState,
  PollVoterEligibilitySource,
  PollVotingStyle,
  SubmitCacicElectionSlateMemberRequest,
} from '@org/voting-contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { setMilliseconds, setSeconds } from 'date-fns';
import { Observable, Subscriber } from 'rxjs';
import {
  PollElementType as DbPollElementType,
  PollImagePlacement as DbPollImagePlacement,
  PollMode as DbPollMode,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  CacicElectionPhase as DbCacicElectionPhase,
  CacicElectionSlateStatus as DbCacicElectionSlateStatus,
  CacicElectionSlateSubmissionSource as DbCacicElectionSlateSubmissionSource,
  CacicElectionSlateMemberIdentifierType as DbCacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole as DbCacicElectionSlateMemberRole,
  Prisma,
} from '@prisma/client';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddPollEligibilityEnrollmentsDto,
  ImportPollEligibilityEnrollmentsDto,
  RejectCacicElectionSlateDto,
  SavePollDto,
  SubmitPollResponseDto,
  SubmitCacicElectionSlateDto,
  UpdateCacicElectionSlateDto,
  UpdateCacicElectionSlateEnabledDto,
} from './dto/poll.dto';
import { PollImagesService } from './poll-images.service';

type PollRecord = {
  id: string;
  title: string;
  description: string | null;
  status: DbPollStatus;
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
  votingStyle: DbPollVotingStyle;
  voterEligibilitySource: DbPollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  directLinkEnabled: boolean;
  directLinkToken: string | null;
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
  visibleFrom: Date | null;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
  elements: ElementRecord[];
  images?: ImageRecord[];
  _count?: {
    responses: number;
  };
};

type ElementRecord = {
  id: string;
  type: DbPollElementType;
  title: string;
  description: string | null;
  required: boolean;
  settings: Prisma.JsonValue | null;
  position: number;
  options: OptionRecord[];
};

type OptionRecord = {
  id: string;
  label: string;
  description: string | null;
  position: number;
};

type ImageRecord = {
  id: string;
  pollId: string;
  placement: DbPollImagePlacement;
  elementId: string | null;
  width: number;
  height: number;
  altText: string | null;
  caption: string | null;
  position: number;
};

type EligibilityEnrollmentRecord = {
  pollId: string;
  enrollmentNumber: string;
  createdAt: Date;
};

type ParsedEligibilityEnrollments = {
  enrollmentNumbers: string[];
  duplicateCount: number;
  invalidCount: number;
};

type PollMetadataData = {
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
  votingStyle: DbPollVotingStyle;
  voterEligibilitySource: DbPollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  linkedEventId: string | null;
  linkedEventName: string | null;
  linkedEventStartDate: Date | null;
  linkedEventEndDate: Date | null;
  linkedEventLocationDescription: string | null;
};

type PollResultVisibilityData = {
  resultsPublic: boolean;
  resultsLive: boolean;
};

type PollPublicationScheduleData = {
  visibleFrom: Date | null;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
};

type PollResponseOptionsData = {
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
};

type PollDirectLinkData = {
  directLinkEnabled: boolean;
  directLinkToken: string | null;
};

type PollImageReferenceData = {
  id: string;
  placement: 'POLL_DESCRIPTION' | 'ELEMENT_DESCRIPTION';
  elementId: string | null;
  position: number;
  altText?: string;
  caption?: string;
};

type PollResultsMetadata = {
  id: string;
  status: DbPollStatus;
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
  votingStyle: DbPollVotingStyle;
  voterEligibilitySource: DbPollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  linkedEventId: string | null;
  resultsPublic: boolean;
  resultsLive: boolean;
  visibleFrom: Date | null;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
};

type PollEligibilityRecord = Pick<
  PollRecord,
  'id' | 'mode' | 'cacicElectionPhase' | 'voterEligibilitySource' | 'requireVerifiedUnespRole' | 'linkedEventId'
>;

type PollUserResponseStateRecord = {
  id: string;
  status: DbPollStatus;
  mode: DbPollMode;
  cacicElectionPhase: DbCacicElectionPhase | null;
  votingStyle: DbPollVotingStyle;
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
  visibleFrom: Date | null;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
};

type PollContractOptions = {
  includeDirectLinkToken?: boolean;
  imageDirectLinkToken?: string;
};

type CacicElectionSlateRecord = Prisma.CacicElectionSlateGetPayload<{
  include: {
    members: {
      orderBy: {
        position: 'asc';
      };
    };
    submittedBy: {
      select: {
        id: true;
        name: true;
        preferredUsername: true;
        email: true;
      };
    };
  };
}>;

type CacicElectionSlateMemberInput = SubmitCacicElectionSlateMemberRequest & {
  id?: string;
};

type NormalizedCacicElectionSlateMember = {
  id?: string;
  fullName: string;
  enrollmentNumber: string | null;
  role: DbCacicElectionSlateMemberRole;
  customRole: string | null;
  isRepresentative: boolean;
  identifierType: DbCacicElectionSlateMemberIdentifierType;
  identifierValue: string;
};

type CacicElectionSlateListOptions = {
  includePrivateIdentifiers: boolean;
};

type PollResultResponseRecord = Prisma.PollResponseGetPayload<{
  include: {
    answers: {
      select: {
        elementId: true;
        value: true;
      };
    };
    user: {
      select: {
        id: true;
        name: true;
        preferredUsername: true;
        email: true;
        claims: true;
      };
    };
  };
}>;

type PollResultStreamEvent = {
  admin: PollResultsDelta;
  public: PollResultsDelta;
};

const pollInclude = {
  elements: {
    orderBy: { position: 'asc' },
    include: {
      options: {
        orderBy: { position: 'asc' },
      },
    },
  },
  images: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  _count: {
    select: {
      responses: true,
    },
  },
} satisfies Prisma.PollInclude;

const MAX_ENROLLMENT_NUMBER_LENGTH = 64;
const MAX_ELEMENT_OPTIONS = 80;
const MAX_DESCRIPTION_IMAGES = 8;
const MAX_POLL_IMAGES = 80;
const LINEAR_SCALE_MIN_VALUES = [0, 1] as const;
const LINEAR_SCALE_MAX_MINIMUM = 2;
const LINEAR_SCALE_MAX_MAXIMUM = 10;
const STAR_RATING_MINIMUM = 3;
const STAR_RATING_MAXIMUM = 10;
const SCHEDULING_DURATION_MINIMUM = 5;
const SCHEDULING_DURATION_MAXIMUM = 480;
const SCHEDULING_INTERVAL_MINIMUM = 5;
const SCHEDULING_INTERVAL_MAXIMUM = 180;
const SCHEDULING_BUFFER_MAXIMUM = 120;
const SCHEDULING_MAX_INVITEES = 20;
const SCHEDULING_MAX_AVAILABILITY_WINDOWS = 120;
const SCHEDULING_INVITEE_MODES = ['none', 'optional', 'required'] as const satisfies readonly PollSchedulingInviteeMode[];
const UNESP_EMAIL_DOMAIN = '@unesp.br';
const COMPUTER_SCIENCE_COURSE_CODE = '12';
const UNDERGRADUATE_UNESP_ROLE = 'aluno-graduacao';
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIN_CACIC_ELECTION_SLATE_MEMBERS = 6;
const CACIC_ELECTION_REQUIRED_ROLES = [
  DbCacicElectionSlateMemberRole.PRESIDENT,
  DbCacicElectionSlateMemberRole.VICE_PRESIDENT,
  DbCacicElectionSlateMemberRole.FINANCIAL_DIRECTOR,
  DbCacicElectionSlateMemberRole.COMMUNICATION_DIRECTOR,
  DbCacicElectionSlateMemberRole.EVENTS_DIRECTOR,
  DbCacicElectionSlateMemberRole.PUBLIC_RELATIONS_DIRECTOR,
] as const;

function createUuidV7(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();
  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff;
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff;
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff;
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [
    bytes.subarray(0, 4),
    bytes.subarray(4, 6),
    bytes.subarray(6, 8),
    bytes.subarray(8, 10),
    bytes.subarray(10, 16),
  ]
    .map((chunk) => chunk.toString('hex'))
    .join('-');
}

@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name);
  private readonly resultSubscribers = new Map<string, Set<(event: PollResultStreamEvent) => void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly accountManager: AccountManagerIntegrationService,
    private readonly pollImages?: PollImagesService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.eventManager.listLinkableEvents();
  }

  async listAdminPolls(): Promise<PollSummary[]> {
    const polls = await this.prisma.poll.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: true,
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => ({
      id: poll.id,
      title: poll.title,
      description: poll.description ?? undefined,
      status: this.toContractStatus(poll.status),
      mode: this.toContractPollMode(poll.mode),
      cacicElectionPhase: this.toContractCacicElectionPhase(poll.cacicElectionPhase),
      votingStyle: this.toContractVotingStyle(poll.votingStyle),
      voterEligibilitySource: this.toContractVoterEligibilitySource(poll.voterEligibilitySource),
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsLive,
      allowResponseEditing: poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEvent: this.toContractLinkedEvent(poll),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
      publishedAt: poll.publishedAt?.toISOString(),
      visibleFrom: poll.visibleFrom?.toISOString(),
      votingStartsAt: poll.votingStartsAt?.toISOString(),
      votingEndsAt: poll.votingEndsAt?.toISOString(),
      elementCount: poll._count.elements,
      responseCount: poll._count.responses,
    }));
  }

  async listPublicPolls(): Promise<PollSummary[]> {
    const now = new Date();
    const polls = await this.prisma.poll.findMany({
      where: this.publicReadablePollWhere(now),
      orderBy: { publishedAt: 'desc' },
      include: {
        _count: {
          select: {
            elements: true,
            responses: true,
          },
        },
      },
    });

    return polls.map((poll) => ({
      id: poll.id,
      title: poll.title,
      description: poll.description ?? undefined,
      status: this.toContractStatus(poll.status),
      mode: this.toContractPollMode(poll.mode),
      cacicElectionPhase: this.toContractCacicElectionPhase(poll.cacicElectionPhase),
      votingStyle: this.toContractVotingStyle(poll.votingStyle),
      voterEligibilitySource: this.toContractVoterEligibilitySource(poll.voterEligibilitySource),
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsLive,
      allowResponseEditing: poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEvent: this.toContractLinkedEvent(poll),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
      publishedAt: poll.publishedAt?.toISOString(),
      visibleFrom: poll.visibleFrom?.toISOString(),
      votingStartsAt: poll.votingStartsAt?.toISOString(),
      votingEndsAt: poll.votingEndsAt?.toISOString(),
      elementCount: poll._count.elements,
      responseCount: poll._count.responses,
    }));
  }

  async getAdminPoll(id: string): Promise<Poll> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return this.toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async getPublishedPoll(id: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...this.publicReadablePollWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = this.requireAuthenticatedVoter(user);
    if (this.shouldRequireVotingEligibilityForRead(poll)) {
      await this.ensureVotingAllowed(poll, voter);
    }
    return this.toContractPoll(poll);
  }

  async getPublishedPollByDirectLink(directLinkToken: string, user?: AuthenticatedPrincipal): Promise<Poll> {
    const normalizedToken = this.normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...this.publicReadablePollWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    this.requireAuthenticatedVoter(user);
    return this.toContractPoll(poll, { imageDirectLinkToken: normalizedToken });
  }

  async assertPublishedPollReadable(id: string, user?: AuthenticatedPrincipal): Promise<void> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...this.publicReadablePollWhere(now),
      },
      select: {
        id: true,
        mode: true,
        cacicElectionPhase: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = this.requireAuthenticatedVoter(user);
    if (this.shouldRequireVotingEligibilityForRead(poll)) {
      await this.ensureVotingAllowed(poll, voter);
    }
  }

  async assertPublishedDirectLinkPollReadable(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<string> {
    const normalizedToken = this.normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...this.publicReadablePollWhere(now),
      },
      select: {
        id: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    this.requireAuthenticatedVoter(user);
    return poll.id;
  }

  async getAdminPollResults(id: string): Promise<PollResults> {
    const poll = await this.getPollResultsMetadata(id);
    const responses = this.areAnswersReleased(poll) ? await this.listPollResultResponses(id) : [];
    const responseCount = await this.countPollResponses(id);
    const voters = await this.listPollResultVoters(id);

    return this.toPollResults(poll, responses, 'admin', { responseCount, voters });
  }

  async exportCacicElectionVoterEnrollments(id: string): Promise<string> {
    const poll = await this.getPollResultsMetadata(id);
    if (!this.isCacicElectionVotingPoll(poll)) {
      throw new BadRequestException('Only CACiC election polls can export voter enrollments.');
    }

    if (poll.status !== DbPollStatus.CLOSED) {
      throw new ForbiddenException('CACiC election voter enrollments are available only after the election is closed.');
    }

    const voters = await this.listPollResultVoters(id);
    return voters
      .map((voter) => voter.enrollmentNumber?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
  }

  async getPublicPollResults(id: string, user?: AuthenticatedPrincipal): Promise<PollResults> {
    const poll = await this.getPollResultsMetadata(id);
    this.assertPublicResultsVisible(poll);
    await this.ensureVotingAllowed(poll, this.requireAuthenticatedVoter(user));
    const responses = await this.listPollResultResponses(id);

    return this.toPollResults(poll, responses, 'public', { responseCount: responses.length });
  }

  async getDirectLinkPublicPollResults(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResults> {
    const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
    this.assertPublicResultsVisible(poll);
    this.requireAuthenticatedVoter(user);
    const responses = await this.listPollResultResponses(poll.id);

    return this.toPollResults(poll, responses, 'public', { responseCount: responses.length });
  }

  streamAdminPollResults(id: string, after: number): Observable<MessageEvent> {
    return this.streamPollResults(id, after, 'admin');
  }

  streamPublicPollResults(id: string, after: number, user?: AuthenticatedPrincipal): Observable<MessageEvent> {
    return this.streamPollResults(id, after, 'public', user);
  }

  streamDirectLinkPublicPollResults(
    directLinkToken: string,
    after: number,
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
        this.assertPublicResultsVisible(poll);
        this.requireAuthenticatedVoter(user);

        const catchUp = await this.getPollResultsDelta(poll, after, 'public');
        if (catchUp.responses.length > 0 || catchUp.responseCount !== after) {
          subscriber.next({ data: catchUp });
        }

        unsubscribe = this.subscribeToPollResults(poll.id, (event) => {
          void this.emitDirectLinkPublicPollResultEvent(directLinkToken, user, subscriber, event);
        });
      })().catch((error: unknown) => {
        subscriber.error(error);
      });

      return () => {
        unsubscribe?.();
      };
    });
  }

  private async getPollResultsMetadata(id: string): Promise<PollResultsMetadata> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return poll;
  }

  private async getDirectLinkPollResultsMetadata(directLinkToken: string): Promise<PollResultsMetadata> {
    const normalizedToken = this.normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...this.publicReadablePollWhere(now),
      },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
        resultsPublic: true,
        resultsLive: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return poll;
  }

  private listPollResultResponses(pollId: string, skip = 0): Promise<PollResultResponseRecord[]> {
    return this.prisma.pollResponse.findMany({
      where: { pollId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      include: {
        answers: {
          select: {
            elementId: true,
            value: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            preferredUsername: true,
            email: true,
            claims: true,
          },
        },
      },
    });
  }

  private countPollResponses(pollId: string): Promise<number> {
    return this.prisma.pollResponse.count({ where: { pollId } });
  }

  private async listPollResultVoters(pollId: string): Promise<PollResultsVoter[]> {
    const voters = await this.prisma.pollVoter.findMany({
      where: { pollId },
      orderBy: {
        userId: 'asc',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            preferredUsername: true,
            email: true,
            claims: true,
          },
        },
      },
    });

    return voters.flatMap((voter) => (voter.user ? [this.toPollResultsVoter(voter.user)] : []));
  }

  private async getPollResultsDelta(
    poll: PollResultsMetadata,
    after: number,
    audience: 'admin' | 'public',
  ): Promise<PollResultsDelta> {
    const responseCount = await this.countPollResponses(poll.id);
    const normalizedAfter = Math.min(Math.max(0, after), responseCount);
    const answersReleased = this.areAnswersReleased(poll);
    const responses = answersReleased ? await this.listPollResultResponses(poll.id, normalizedAfter) : [];
    const voters = audience === 'admin' ? await this.listPollResultVoters(poll.id) : undefined;

    return {
      pollId: poll.id,
      answersReleased,
      responseCount,
      ...(voters ? { voterCount: voters.length, voters } : {}),
      responses: responses.map((response) => this.toPollResultsResponse(response, audience)),
    };
  }

  private toPollResults(
    poll: PollResultsMetadata,
    responses: PollResultResponseRecord[],
    audience: 'admin' | 'public',
    options: {
      responseCount: number;
      voters?: PollResultsVoter[];
    },
  ): PollResults {
    const answersReleased = this.areAnswersReleased(poll);
    return {
      pollId: poll.id,
      anonymous: poll.votingStyle === DbPollVotingStyle.ANONYMOUS,
      answersReleased,
      responseCount: options.responseCount,
      ...(audience === 'admin' && options.voters
        ? { voterCount: options.voters.length, voters: options.voters }
        : {}),
      responses: answersReleased ? responses.map((response) => this.toPollResultsResponse(response, audience)) : [],
    };
  }

  private toPollResultsResponse(
    response: PollResultResponseRecord,
    audience: 'admin' | 'public',
  ): PollResultsResponse {
    return {
      id: response.id,
      submittedAt: audience === 'admin' ? response.submittedAt?.toISOString() : undefined,
      voter: audience === 'admin' && response.user ? this.toPollResultsVoter(response.user) : undefined,
      answers: response.answers.map((answer) => ({
        elementId: answer.elementId,
        value: answer.value as PollResponseAnswer['value'],
      })),
    };
  }

  private assertPublicResultsVisible(poll: PollResultsMetadata): void {
    if (!this.isPollPubliclyVisible(poll, new Date())) {
      throw new NotFoundException('Poll not found.');
    }

    if (!poll.resultsPublic) {
      throw new ForbiddenException('Poll results are not public.');
    }

    if (this.isCacicElectionVotingPoll(poll)) {
      if (poll.status === DbPollStatus.CLOSED) {
        return;
      }

      throw new ForbiddenException('CACiC election results are released only after the election is closed.');
    }

    if (poll.status === DbPollStatus.CLOSED) {
      return;
    }

    if (poll.status === DbPollStatus.PUBLISHED && poll.resultsLive) {
      return;
    }

    throw new ForbiddenException('Poll results are not public yet.');
  }

  private areAnswersReleased(poll: Pick<PollResultsMetadata, 'mode' | 'cacicElectionPhase' | 'status'>): boolean {
    return !this.isCacicElectionVotingPoll(poll) || poll.status === DbPollStatus.CLOSED;
  }

  private isCacicElectionVotingPoll(
    poll: Pick<PollResultsMetadata, 'mode' | 'cacicElectionPhase'>,
  ): boolean {
    return poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase === DbCacicElectionPhase.ELECTION;
  }

  private shouldRequireVotingEligibilityForRead(
    poll: Pick<PollEligibilityRecord, 'mode' | 'cacicElectionPhase'>,
  ): boolean {
    return !(poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase === DbCacicElectionPhase.SLATE_SUBMISSION);
  }

  private publicReadablePollWhere(now: Date): Prisma.PollWhereInput {
    return {
      OR: [
        {
          status: DbPollStatus.PUBLISHED,
          OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
        },
        {
          status: DbPollStatus.CLOSED,
          resultsPublic: true,
          OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
        },
      ],
    };
  }

  private pollVotingOpenWhere(now: Date): Prisma.PollWhereInput {
    return {
      OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
      AND: [
        {
          OR: [{ votingStartsAt: null }, { votingStartsAt: { lte: now } }],
        },
        {
          OR: [{ votingEndsAt: null }, { votingEndsAt: { gt: now } }],
        },
      ],
    };
  }

  private isPollPubliclyVisible(poll: Pick<PollRecord, 'status' | 'resultsPublic' | 'visibleFrom'>, now: Date): boolean {
    const hasVisibleStarted = !poll.visibleFrom || poll.visibleFrom <= now;
    if (!hasVisibleStarted) {
      return false;
    }

    return poll.status === DbPollStatus.PUBLISHED || (poll.status === DbPollStatus.CLOSED && poll.resultsPublic);
  }

  private isPollVotingOpen(
    poll: Pick<PollRecord, 'status' | 'visibleFrom' | 'votingStartsAt' | 'votingEndsAt'>,
    now: Date,
  ): boolean {
    return (
      poll.status === DbPollStatus.PUBLISHED &&
      (!poll.visibleFrom || poll.visibleFrom <= now) &&
      (!poll.votingStartsAt || poll.votingStartsAt <= now) &&
      (!poll.votingEndsAt || poll.votingEndsAt > now)
    );
  }

  private assertPollAcceptsVoteResponses(poll: Pick<PollRecord, 'mode' | 'cacicElectionPhase'>): void {
    if (poll.mode === DbPollMode.CACIC_ELECTION && poll.cacicElectionPhase !== DbCacicElectionPhase.ELECTION) {
      throw new BadRequestException('Slate submissions must use the CACiC election slate endpoint.');
    }
  }

  private streamPollResults(
    id: string,
    after: number,
    audience: 'admin' | 'public',
    user?: AuthenticatedPrincipal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      void (async () => {
        const poll = await this.getPollResultsMetadata(id);
        if (audience === 'public') {
          this.assertPublicResultsVisible(poll);
          await this.ensureVotingAllowed(poll, this.requireAuthenticatedVoter(user));
        }

        const catchUp = await this.getPollResultsDelta(poll, after, audience);
        if (catchUp.responses.length > 0 || catchUp.responseCount !== after) {
          subscriber.next({ data: catchUp });
        }

        unsubscribe = this.subscribeToPollResults(id, (event) => {
          if (audience === 'admin') {
            subscriber.next({ data: event.admin });
            return;
          }

          void this.emitPublicPollResultEvent(id, user, subscriber, event);
        });
      })().catch((error: unknown) => {
        subscriber.error(error);
      });

      return () => {
        unsubscribe?.();
      };
    });
  }

  private async emitPublicPollResultEvent(
    id: string,
    user: AuthenticatedPrincipal | undefined,
    subscriber: Subscriber<MessageEvent>,
    event: PollResultStreamEvent,
  ): Promise<void> {
    try {
      if (subscriber.closed) {
        return;
      }

      const poll = await this.getPollResultsMetadata(id);
      this.assertPublicResultsVisible(poll);
      await this.ensureVotingAllowed(poll, this.requireAuthenticatedVoter(user));

      if (!subscriber.closed) {
        subscriber.next({ data: event.public });
      }
    } catch (error: unknown) {
      if (!subscriber.closed) {
        subscriber.error(error);
      }
    }
  }

  private async emitDirectLinkPublicPollResultEvent(
    directLinkToken: string,
    user: AuthenticatedPrincipal | undefined,
    subscriber: Subscriber<MessageEvent>,
    event: PollResultStreamEvent,
  ): Promise<void> {
    try {
      if (subscriber.closed) {
        return;
      }

      const poll = await this.getDirectLinkPollResultsMetadata(directLinkToken);
      this.assertPublicResultsVisible(poll);
      this.requireAuthenticatedVoter(user);

      if (!subscriber.closed && poll.id === event.public.pollId) {
        subscriber.next({ data: event.public });
      }
    } catch (error: unknown) {
      if (!subscriber.closed) {
        subscriber.error(error);
      }
    }
  }

  private subscribeToPollResults(pollId: string, listener: (event: PollResultStreamEvent) => void): () => void {
    const existingListeners = this.resultSubscribers.get(pollId) ?? new Set<(event: PollResultStreamEvent) => void>();
    existingListeners.add(listener);
    this.resultSubscribers.set(pollId, existingListeners);

    return () => {
      existingListeners.delete(listener);
      if (existingListeners.size === 0) {
        this.resultSubscribers.delete(pollId);
      }
    };
  }

  private publishPollResults(event: PollResultStreamEvent): void {
    const listeners = this.resultSubscribers.get(event.admin.pollId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  async createPoll(input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    const metadata = await this.resolvePollMetadata(input);
    const resultVisibility = this.resolvePollResultVisibility(input, undefined, metadata);
    const responseOptions = this.resolvePollResponseOptions(input, undefined, metadata);
    const directLink = this.resolvePollDirectLink(input, undefined, metadata);
    const publicationSchedule = this.resolvePollPublicationSchedule(input, undefined);
    this.validatePollPublicationSchedule(publicationSchedule);
    const status = this.toDbStatus(input.status ?? 'draft');
    const now = new Date();

    const removedImageObjectKeys: string[] = [];
    const poll = await this.prisma.$transaction(async (tx) => {
      const created = await tx.poll.create({
        data: {
          title: input.title.trim(),
          description: this.cleanOptionalText(input.description),
          status,
          ...metadata,
          ...resultVisibility,
          ...responseOptions,
          ...directLink,
          ...publicationSchedule,
          publishedAt: status === DbPollStatus.PUBLISHED ? now : undefined,
          closedAt: status === DbPollStatus.CLOSED ? now : undefined,
          createdById: user.sub,
          updatedById: user.sub,
        },
      });

      await this.replaceElements(tx, created.id, await this.resolvePollElementsForSave(tx, created.id, input, metadata));
      removedImageObjectKeys.push(...(await this.reconcilePollImages(tx, created.id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id: created.id },
        include: pollInclude,
      });
    });

    await this.pollImages?.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return this.toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePoll(id: string, input: SavePollDto, user: AuthenticatedPrincipal): Promise<Poll> {
    this.validatePollInput(input);
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const status = this.toDbStatus(input.status ?? this.toContractStatus(existing.status));
    const metadata = await this.resolvePollMetadata(input, existing);
    const resultVisibility = this.resolvePollResultVisibility(input, existing, metadata);
    const responseOptions = this.resolvePollResponseOptions(input, existing, metadata);
    const directLink = this.resolvePollDirectLink(input, existing, metadata);
    const publicationSchedule = this.resolvePollPublicationSchedule(input, existing);
    this.validatePollPublicationSchedule(publicationSchedule);
    const now = new Date();

    const removedImageObjectKeys: string[] = [];
    const poll = await this.prisma.$transaction(async (tx) => {
      await tx.poll.update({
        where: { id },
        data: {
          title: input.title.trim(),
          description: this.cleanOptionalText(input.description),
          status,
          ...metadata,
          ...resultVisibility,
          ...responseOptions,
          ...directLink,
          ...publicationSchedule,
          publishedAt: status === DbPollStatus.PUBLISHED ? existing.publishedAt ?? now : existing.publishedAt,
          closedAt: status === DbPollStatus.CLOSED ? existing.closedAt ?? now : null,
          updatedById: user.sub,
        },
      });

      await this.replaceElements(tx, id, await this.resolvePollElementsForSave(tx, id, input, metadata));
      removedImageObjectKeys.push(...(await this.reconcilePollImages(tx, id, input)));

      return tx.poll.findUniqueOrThrow({
        where: { id },
        include: pollInclude,
      });
    });

    await this.pollImages?.deleteObjectKeysBestEffort(removedImageObjectKeys);
    return this.toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async updatePollStatus(id: string, status: PollStatus, user: AuthenticatedPrincipal): Promise<Poll> {
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Poll not found.');
    }

    const dbStatus = this.toDbStatus(status);
    const now = new Date();
    const poll = await this.prisma.poll.update({
      where: { id },
      data: {
        status: dbStatus,
        publishedAt: dbStatus === DbPollStatus.PUBLISHED ? existing.publishedAt ?? now : existing.publishedAt,
        closedAt: dbStatus === DbPollStatus.CLOSED ? existing.closedAt ?? now : null,
        updatedById: user.sub,
      },
      include: pollInclude,
    });

    return this.toContractPoll(poll, { includeDirectLinkToken: true });
  }

  async deletePoll(id: string): Promise<void> {
    const images = await this.prisma.pollImage.findMany({
      where: { pollId: id },
      select: { objectKey: true },
    });
    await this.prisma.poll.deleteMany({ where: { id } });
    await this.pollImages?.deleteObjectKeysBestEffort(images.map((image) => image.objectKey));
  }

  async listEligibilityEnrollments(pollId: string): Promise<PollEligibilityEnrollmentList> {
    await this.assertPollExists(pollId);
    const records = await this.prisma.pollEligibilityEnrollment.findMany({
      where: { pollId },
      orderBy: {
        enrollmentNumber: 'asc',
      },
      select: {
        pollId: true,
        enrollmentNumber: true,
        createdAt: true,
      },
    });

    return this.toEligibilityEnrollmentList(records);
  }

  async addEligibilityEnrollments(
    pollId: string,
    input: AddPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    await this.assertPollExists(pollId);
    const parsed = this.normalizeEnrollmentNumbers(input.enrollmentNumbers);
    return this.replaceOrAppendEligibilityEnrollments(pollId, parsed, 'append', user.sub);
  }

  async importEligibilityEnrollments(
    pollId: string,
    input: ImportPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    await this.assertPollExists(pollId);
    const parsed = this.parseEligibilityImport(input);
    return this.replaceOrAppendEligibilityEnrollments(pollId, parsed, input.mode ?? 'append', user.sub);
  }

  async deleteEligibilityEnrollment(pollId: string, enrollmentNumber: string): Promise<void> {
    await this.assertPollExists(pollId);
    const normalizedEnrollmentNumber = this.normalizeEnrollmentNumber(enrollmentNumber);
    if (!normalizedEnrollmentNumber) {
      throw new BadRequestException('Enrollment number is required.');
    }

    await this.prisma.pollEligibilityEnrollment.deleteMany({
      where: {
        pollId,
        enrollmentNumber: normalizedEnrollmentNumber,
      },
    });
  }

  async clearEligibilityEnrollments(pollId: string): Promise<PollEligibilityEnrollmentList> {
    await this.assertPollExists(pollId);
    await this.prisma.pollEligibilityEnrollment.deleteMany({ where: { pollId } });
    return {
      entries: [],
      totalCount: 0,
    };
  }

  async listPublicCacicElectionSlates(pollId: string, user?: AuthenticatedPrincipal): Promise<CacicElectionSlate[]> {
    this.requireAuthenticatedVoter(user);
    await this.assertPublicCacicElectionSlatePollReadable(pollId);
    const slates = await this.prisma.cacicElectionSlate.findMany({
      where: {
        pollId,
        status: DbCacicElectionSlateStatus.APPROVED,
        enabled: true,
      },
      orderBy: [{ name: 'asc' }, { submittedAt: 'asc' }],
      include: this.cacicElectionSlateInclude(),
    });

    return slates.map((slate) => this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: false }));
  }

  async getMyCacicElectionSlate(
    pollId: string,
    user?: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate | null> {
    const voter = this.requireAuthenticatedVoter(user);
    await this.assertCacicElectionSlateSubmissionOpen(pollId);
    const slate = await this.prisma.cacicElectionSlate.findUnique({
      where: {
        pollId_submittedById: {
          pollId,
          submittedById: voter.sub,
        },
      },
      include: this.cacicElectionSlateInclude(),
    });

    return slate ? this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true }) : null;
  }

  async submitCacicElectionSlate(
    pollId: string,
    input: SubmitCacicElectionSlateDto,
    user?: AuthenticatedPrincipal,
  ): Promise<CacicElectionSlate> {
    const voter = this.requireAuthenticatedVoter(user);
    await this.assertCacicElectionSlateSubmissionOpen(pollId);
    const name = this.normalizeSlateName(input.name);
    const members = await this.normalizeCacicElectionSlateMembers(input.members);

    try {
      const slate = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.cacicElectionSlate.findUnique({
          where: {
            pollId_submittedById: {
              pollId,
              submittedById: voter.sub,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (existing?.status === DbCacicElectionSlateStatus.APPROVED) {
          throw new ConflictException('This user already has an approved slate for this election.');
        }

        const slateId = existing?.id;
        const saved = slateId
          ? await tx.cacicElectionSlate.update({
              where: { id: slateId },
              data: {
                name,
                status: DbCacicElectionSlateStatus.PENDING,
                enabled: true,
                rejectionReason: null,
                reviewedAt: null,
                reviewedById: null,
                submittedAt: new Date(),
              },
            })
          : await tx.cacicElectionSlate.create({
              data: {
                pollId,
                name,
                status: DbCacicElectionSlateStatus.PENDING,
                enabled: true,
                submissionSource: DbCacicElectionSlateSubmissionSource.PUBLIC,
                submittedById: voter.sub,
              },
            });

        await this.replaceCacicElectionSlateMembers(tx, saved.id, members);
        return tx.cacicElectionSlate.findUniqueOrThrow({
          where: { id: saved.id },
          include: this.cacicElectionSlateInclude(),
        });
      });

      return this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: false });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('This user already submitted a slate for this election.');
      }

      throw error;
    }
  }

  async listAdminCacicElectionSlates(pollId: string): Promise<AdminCacicElectionSlate[]> {
    await this.assertCacicElectionPollExists(pollId);
    const slates = await this.prisma.cacicElectionSlate.findMany({
      where: { pollId },
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }, { name: 'asc' }],
      include: this.cacicElectionSlateInclude(),
    });

    return slates.map((slate) => this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true }));
  }

  async createAdminCacicElectionSlate(
    pollId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const name = this.normalizeSlateName(input.name);
    const members = await this.normalizeCacicElectionSlateMembers(input.members);
    const status = input.status ? this.toDbCacicElectionSlateStatus(input.status) : DbCacicElectionSlateStatus.APPROVED;

    const slate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cacicElectionSlate.create({
        data: {
          pollId,
          name,
          status,
          enabled: input.enabled ?? true,
          submissionSource: DbCacicElectionSlateSubmissionSource.ADMIN,
          adminCreatedById: user.sub,
          reviewedById: status === DbCacicElectionSlateStatus.APPROVED ? user.sub : null,
          reviewedAt: status === DbCacicElectionSlateStatus.APPROVED ? new Date() : null,
        },
      });
      await this.replaceCacicElectionSlateMembers(tx, created.id, members);
      await this.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: created.id },
        include: this.cacicElectionSlateInclude(),
      });
    });

    return this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async updateAdminCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const name = this.normalizeSlateName(input.name);
    const members = await this.normalizeCacicElectionSlateMembers(input.members);
    const status = input.status ? this.toDbCacicElectionSlateStatus(input.status) : undefined;
    if (status === DbCacicElectionSlateStatus.REJECTED) {
      throw new BadRequestException('Use the rejection endpoint to reject a slate with a reason.');
    }

    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          name,
          ...(status
            ? {
                status,
                rejectionReason: null,
                reviewedById: status === DbCacicElectionSlateStatus.APPROVED ? user.sub : null,
                reviewedAt: status === DbCacicElectionSlateStatus.APPROVED ? new Date() : null,
              }
            : {}),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        },
      });
      await this.replaceCacicElectionSlateMembers(tx, updated.id, members);
      await this.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: this.cacicElectionSlateInclude(),
      });
    });

    return this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async rejectCacicElectionSlate(
    pollId: string,
    slateId: string,
    input: RejectCacicElectionSlateDto,
    user: AuthenticatedPrincipal,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const reason = this.cleanOptionalText(input.reason);
    if (!reason) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          status: DbCacicElectionSlateStatus.REJECTED,
          enabled: false,
          rejectionReason: reason,
          reviewedById: user.sub,
          reviewedAt: new Date(),
        },
      });
      await this.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: this.cacicElectionSlateInclude(),
      });
    });

    return this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async updateCacicElectionSlateEnabled(
    pollId: string,
    slateId: string,
    input: UpdateCacicElectionSlateEnabledDto,
  ): Promise<AdminCacicElectionSlate> {
    await this.assertCacicElectionPollExists(pollId);
    const slate = await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      const updated = await tx.cacicElectionSlate.update({
        where: { id: slateId },
        data: {
          enabled: input.enabled,
        },
      });
      await this.refreshCacicElectionVoteElement(tx, pollId);
      return tx.cacicElectionSlate.findUniqueOrThrow({
        where: { id: updated.id },
        include: this.cacicElectionSlateInclude(),
      });
    });

    return this.toContractCacicElectionSlate(slate, { includePrivateIdentifiers: true });
  }

  async deleteCacicElectionSlate(pollId: string, slateId: string): Promise<void> {
    await this.assertCacicElectionPollExists(pollId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertCacicElectionSlateBelongsToPoll(tx, pollId, slateId);
      await tx.cacicElectionSlate.delete({ where: { id: slateId } });
      await this.refreshCacicElectionVoteElement(tx, pollId);
    });
  }

  async submitResponse(id: string, input: SubmitPollResponseDto, user?: AuthenticatedPrincipal): Promise<PollResponse> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        status: DbPollStatus.PUBLISHED,
        ...this.pollVotingOpenWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    this.assertPollAcceptsVoteResponses(poll);
    const voter = this.requireAuthenticatedVoter(user);
    await this.ensureVotingAllowed(poll, voter);
    const answers = this.validateResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.publishPollResultsForResponse(poll.id);

    return this.toContractResponse(response);
  }

  async submitDirectLinkResponse(
    directLinkToken: string,
    input: SubmitPollResponseDto,
    user?: AuthenticatedPrincipal,
  ): Promise<PollResponse> {
    const normalizedToken = this.normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        status: DbPollStatus.PUBLISHED,
        ...this.pollVotingOpenWhere(now),
      },
      include: pollInclude,
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    this.assertPollAcceptsVoteResponses(poll);
    const voter = this.requireAuthenticatedVoter(user);
    const answers = this.validateResponse(poll, input);

    const response = await this.saveResponse(poll, voter.sub, answers);
    await this.publishPollResultsForResponse(poll.id);

    return this.toContractResponse(response);
  }

  async getUserResponseState(id: string, user?: AuthenticatedPrincipal): Promise<PollUserResponseState> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id,
        ...this.publicReadablePollWhere(now),
      },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
        voterEligibilitySource: true,
        requireVerifiedUnespRole: true,
        linkedEventId: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    const voter = this.requireAuthenticatedVoter(user);
    await this.ensureVotingAllowed(poll, voter);
    return this.readUserResponseState(poll, voter);
  }

  async getDirectLinkUserResponseState(
    directLinkToken: string,
    user?: AuthenticatedPrincipal,
  ): Promise<PollUserResponseState> {
    const normalizedToken = this.normalizeDirectLinkToken(directLinkToken);
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        directLinkEnabled: true,
        directLinkToken: normalizedToken,
        ...this.publicReadablePollWhere(now),
      },
      select: {
        id: true,
        status: true,
        mode: true,
        cacicElectionPhase: true,
        votingStyle: true,
        allowResponseEditing: true,
        allowMultipleResponses: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    return this.readUserResponseState(poll, this.requireAuthenticatedVoter(user));
  }

  private async readUserResponseState(
    poll: PollUserResponseStateRecord,
    voter: AuthenticatedVoter,
  ): Promise<PollUserResponseState> {
    const voterRecord = await this.prisma.pollVoter.findUnique({
      where: {
        pollId_userId: {
          pollId: poll.id,
          userId: voter.sub,
        },
      },
      select: {
        userId: true,
      },
    });
    const response =
      poll.votingStyle === DbPollVotingStyle.ANONYMOUS
        ? null
        : await this.findLatestUserResponse(poll.id, voter.sub);
    const hasSubmitted = Boolean(voterRecord ?? response);
    const acceptsResponses = this.isPollVotingOpen(poll, new Date());
    const canSubmitAnother = acceptsResponses && poll.allowMultipleResponses;
    const canEdit =
      acceptsResponses &&
      poll.votingStyle !== DbPollVotingStyle.ANONYMOUS &&
      poll.allowResponseEditing &&
      Boolean(response);

    return {
      hasSubmitted,
      canEdit,
      canSubmitAnother,
      ...(response ? { response: this.toContractResponse(response) } : {}),
    };
  }

  private async saveResponse(
    poll: PollRecord,
    userId: string,
    answers: PollResponseAnswer[],
  ): Promise<PollResultResponseRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const isAnonymous = poll.votingStyle === DbPollVotingStyle.ANONYMOUS;

        if (poll.allowMultipleResponses) {
          await tx.pollVoter.upsert({
            where: {
              pollId_userId: {
                pollId: poll.id,
                userId,
              },
            },
            update: {},
            create: {
              pollId: poll.id,
              userId,
            },
          });

          return this.createResponse(tx, poll.id, userId, answers, isAnonymous);
        }

        const existingVoter = await tx.pollVoter.findUnique({
          where: {
            pollId_userId: {
              pollId: poll.id,
              userId,
            },
          },
          select: {
            userId: true,
          },
        });

        if (existingVoter) {
          if (!poll.allowResponseEditing || isAnonymous) {
            throw new ConflictException('User already voted in this poll.');
          }

          const existingResponse = await tx.pollResponse.findFirst({
            where: {
              pollId: poll.id,
              userId,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
            },
          });

          if (!existingResponse) {
            throw new ConflictException('User already voted in this poll.');
          }

          await tx.pollAnswer.deleteMany({
            where: {
              responseId: existingResponse.id,
            },
          });

          return tx.pollResponse.update({
            where: {
              id: existingResponse.id,
            },
            data: {
              submittedAt: new Date(),
              answers: {
                create: answers.map((answer) => ({
                  elementId: answer.elementId,
                  value: answer.value as Prisma.InputJsonValue,
                })),
              },
            },
            include: this.responseInclude(),
          });
        }

        await tx.pollVoter.create({
          data: {
            pollId: poll.id,
            userId,
          },
        });

        return this.createResponse(tx, poll.id, userId, answers, isAnonymous);
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('User already voted in this poll.');
      }

      throw error;
    }
  }

  private createResponse(
    tx: Prisma.TransactionClient,
    pollId: string,
    userId: string,
    answers: PollResponseAnswer[],
    isAnonymous: boolean,
  ): Promise<PollResultResponseRecord> {
    return tx.pollResponse.create({
      data: {
        pollId,
        ...(isAnonymous
          ? {
              id: randomUUID(),
              userId: null,
              submittedAt: null,
            }
          : {
              userId,
            }),
        answers: {
          create: answers.map((answer) => ({
            ...(isAnonymous ? { id: randomUUID() } : {}),
            elementId: answer.elementId,
            value: answer.value as Prisma.InputJsonValue,
          })),
        },
      },
      include: this.responseInclude(),
    });
  }

  private findLatestUserResponse(pollId: string, userId: string): Promise<PollResultResponseRecord | null> {
    return this.prisma.pollResponse.findFirst({
      where: {
        pollId,
        userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.responseInclude(),
    });
  }

  private responseInclude(): Prisma.PollResponseInclude {
    return {
      answers: {
        select: {
          elementId: true,
          value: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          preferredUsername: true,
          email: true,
          claims: true,
        },
      },
    };
  }

  private toContractResponse(response: PollResultResponseRecord): PollResponse {
    return {
      id: response.id,
      pollId: response.pollId,
      submittedAt: response.submittedAt?.toISOString(),
      answers: response.answers.map((answer) => ({
        elementId: answer.elementId,
        value: answer.value as PollResponseAnswer['value'],
      })),
    };
  }

  private async publishPollResultsForResponse(pollId: string): Promise<void> {
    if (!this.resultSubscribers.has(pollId)) {
      return;
    }

    const poll = await this.getPollResultsMetadata(pollId);
    const responseCount = await this.countPollResponses(pollId);
    const cursorBeforeLatestResponse = Math.max(0, responseCount - 1);
    this.publishPollResults({
      admin: await this.getPollResultsDelta(poll, cursorBeforeLatestResponse, 'admin'),
      public: await this.getPollResultsDelta(poll, cursorBeforeLatestResponse, 'public'),
    });
  }

  private requireAuthenticatedVoter(user?: AuthenticatedPrincipal): AuthenticatedVoter {
    if (!user?.sub) {
      throw new UnauthorizedException('Authentication is required for voting.');
    }

    return user as AuthenticatedVoter;
  }

  private isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  private async resolvePollElementsForSave(
    tx: Prisma.TransactionClient,
    pollId: string,
    input: SavePollDto,
    metadata: PollMetadataData,
  ): Promise<SavePollDto['elements']> {
    if (metadata.mode !== DbPollMode.CACIC_ELECTION) {
      return input.elements;
    }

    return this.resolveCacicElectionElements(tx, pollId, input.elements, metadata.cacicElectionPhase);
  }

  private async resolveCacicElectionElements(
    tx: Prisma.TransactionClient,
    pollId: string,
    elements: SavePollDto['elements'],
    phase: DbCacicElectionPhase | null,
  ): Promise<SavePollDto['elements']> {
    const generatedElement =
      phase === DbCacicElectionPhase.ELECTION
        ? await this.buildCacicElectionVoteElement(tx, pollId)
        : this.buildCacicElectionSlateFormElement();
    const generatedIds = new Set([CACIC_ELECTION_SLATE_FORM_ELEMENT_ID, CACIC_ELECTION_VOTE_ELEMENT_ID]);
    const resolvedElements: SavePollDto['elements'] = [];
    let insertedGeneratedElement = false;

    for (const element of elements) {
      if (!generatedIds.has(element.id)) {
        resolvedElements.push(element);
        continue;
      }

      if (!insertedGeneratedElement && element.id === generatedElement.id) {
        resolvedElements.push(generatedElement);
        insertedGeneratedElement = true;
      }
    }

    return insertedGeneratedElement ? resolvedElements : [generatedElement, ...resolvedElements];
  }

  private buildCacicElectionSlateFormElement(): SavePollDto['elements'][number] {
    return {
      id: CACIC_ELECTION_SLATE_FORM_ELEMENT_ID,
      type: 'statement',
      title: 'Formulário de submissão de chapas',
      description:
        'Campo gerado com nome da chapa, integrantes, matrícula, cargo, identificação, representante e termos obrigatórios.',
      required: false,
      options: [],
    };
  }

  private async buildCacicElectionVoteElement(
    tx: Prisma.TransactionClient,
    pollId: string,
  ): Promise<SavePollDto['elements'][number]> {
    const slates = await tx.cacicElectionSlate.findMany({
      where: {
        pollId,
        status: DbCacicElectionSlateStatus.APPROVED,
        enabled: true,
      },
      orderBy: [{ name: 'asc' }, { submittedAt: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    return {
      id: CACIC_ELECTION_VOTE_ELEMENT_ID,
      type: 'singleChoice',
      title: 'Escolha a chapa',
      description: 'Selecione uma chapa aprovada ou registre voto em branco ou nulo.',
      required: true,
      options: [
        ...slates.map((slate) => ({
          id: this.cacicElectionSlateOptionId(slate.id),
          label: slate.name,
        })),
        {
          id: CACIC_ELECTION_BLANK_OPTION_ID,
          label: 'Branco',
          description: 'Registrar voto em branco.',
        },
        {
          id: CACIC_ELECTION_NULL_OPTION_ID,
          label: 'Nulo',
          description: 'Registrar voto nulo.',
        },
      ],
    };
  }

  private async refreshCacicElectionVoteElement(tx: Prisma.TransactionClient, pollId: string): Promise<void> {
    const poll = await tx.poll.findUnique({
      where: { id: pollId },
      select: {
        mode: true,
        cacicElectionPhase: true,
      },
    });

    if (!poll || poll.mode !== DbPollMode.CACIC_ELECTION || poll.cacicElectionPhase !== DbCacicElectionPhase.ELECTION) {
      return;
    }

    await this.upsertCacicElectionVoteElement(tx, pollId, await this.buildCacicElectionVoteElement(tx, pollId));
  }

  private async upsertCacicElectionVoteElement(
    tx: Prisma.TransactionClient,
    pollId: string,
    element: SavePollDto['elements'][number],
  ): Promise<void> {
    const settings = this.normalizeElementSettings(element);
    const options = element.options.map((option, optionIndex) => ({
      id: option.id,
      label: option.label.trim(),
      description: this.cleanOptionalText(option.description),
      position: optionIndex,
    }));
    const existingElement = await tx.pollElement.findFirst({
      where: {
        id: element.id,
        pollId,
      },
      select: {
        id: true,
      },
    });

    if (existingElement) {
      await tx.pollElement.update({
        where: { id: existingElement.id },
        data: {
          type: this.toDbElementType(element.type),
          title: element.title.trim(),
          description: this.cleanOptionalText(element.description),
          required: element.required,
          settings: settings ? (settings as Prisma.InputJsonValue) : Prisma.JsonNull,
          options: {
            deleteMany: {},
            create: options,
          },
        },
      });
      return;
    }

    const lastElement = await tx.pollElement.findFirst({
      where: { pollId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await tx.pollElement.create({
      data: {
        id: element.id,
        pollId,
        type: this.toDbElementType(element.type),
        title: element.title.trim(),
        description: this.cleanOptionalText(element.description),
        required: element.required,
        ...(settings ? { settings: settings as Prisma.InputJsonValue } : {}),
        position: (lastElement?.position ?? -1) + 1,
        options: {
          create: options,
        },
      },
    });
  }

  private toSavePollElement(element: ElementRecord): SavePollDto['elements'][number] {
    const settings = this.toContractElementSettings(element);
    return {
      id: element.id,
      type: this.toContractElementType(element.type),
      title: element.title,
      ...(element.description ? { description: element.description } : {}),
      required: element.required,
      options: element.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
      ...(settings ? { settings } : {}),
    };
  }

  private async replaceElements(
    tx: Prisma.TransactionClient,
    pollId: string,
    elements: SavePollDto['elements'],
  ): Promise<void> {
    const existingElements = await tx.pollElement.findMany({
      where: { pollId },
      include: {
        options: {
          orderBy: { position: 'asc' },
        },
        _count: {
          select: {
            answers: true,
          },
        },
      },
    });
    const existingById = new Map(existingElements.map((element) => [element.id, element]));
    const inputElementIds = new Set(elements.map((element) => element.id));
    const now = new Date();

    for (const element of existingElements) {
      await tx.pollAnswer.updateMany({
        where: {
          elementId: element.id,
          elementSnapshot: { equals: Prisma.DbNull },
        },
        data: {
          elementSnapshot: this.toElementSnapshotJson(element),
        },
      });

      if (inputElementIds.has(element.id)) {
        continue;
      }

      if (element._count.answers > 0) {
        await tx.pollElement.update({
          where: { id: element.id },
          data: { retiredAt: now },
        });
        continue;
      }

      await tx.pollElement.delete({ where: { id: element.id } });
    }

    for (const [elementIndex, element] of elements.entries()) {
      const existing = existingById.get(element.id);
      const settings = this.normalizeElementSettings(element);
      const data = {
        pollId,
        type: this.toDbElementType(element.type),
        title: element.title.trim(),
        description: this.cleanOptionalText(element.description),
        required: element.required,
        settings: settings ? (settings as Prisma.InputJsonValue) : Prisma.JsonNull,
        position: elementIndex,
        retiredAt: null,
      };

      if (existing) {
        await tx.pollElement.update({
          where: { id: element.id },
          data,
        });
        await this.replaceElementOptions(tx, element.id, element.options);
        continue;
      }

      await tx.pollElement.create({
        data: {
          id: element.id,
          ...data,
          options: {
            create: element.options.map((option, optionIndex) =>
              this.toElementOptionCreateData(option, optionIndex),
            ),
          },
        },
      });
    }
  }

  private async replaceElementOptions(
    tx: Prisma.TransactionClient,
    elementId: string,
    options: SavePollDto['elements'][number]['options'],
  ): Promise<void> {
    await tx.pollElementOption.deleteMany({ where: { elementId } });
    if (options.length === 0) {
      return;
    }

    await tx.pollElementOption.createMany({
      data: options.map((option, optionIndex) => ({
        ...this.toElementOptionCreateData(option, optionIndex),
        elementId,
      })),
    });
  }

  private toElementOptionCreateData(
    option: SavePollDto['elements'][number]['options'][number],
    optionIndex: number,
  ): Prisma.PollElementOptionCreateWithoutElementInput {
    return {
      id: option.id,
      label: option.label.trim(),
      description: this.cleanOptionalText(option.description),
      position: optionIndex,
    };
  }

  private toElementSnapshotJson(element: ElementRecord): Prisma.InputJsonValue {
    return this.toContractElement(element, [], {}) as unknown as Prisma.InputJsonValue;
  }

  private async reconcilePollImages(
    tx: Prisma.TransactionClient,
    pollId: string,
    input: SavePollDto,
  ): Promise<string[]> {
    const references = this.collectImageReferences(input);
    const existingImages = await tx.pollImage.findMany({
      where: { pollId },
      select: {
        id: true,
        objectKey: true,
      },
    });
    const existingById = new Map(existingImages.map((image) => [image.id, image]));

    for (const reference of references) {
      if (!existingById.has(reference.id)) {
        throw new BadRequestException('Poll image reference is invalid.');
      }

      await tx.pollImage.update({
        where: {
          id: reference.id,
        },
        data: {
          placement: reference.placement,
          elementId: reference.elementId,
          position: reference.position,
          altText: reference.altText ?? null,
          caption: reference.caption ?? null,
        },
      });
    }

    const referencedIds = new Set(references.map((reference) => reference.id));
    const removedImages = existingImages.filter((image) => !referencedIds.has(image.id));
    if (removedImages.length > 0) {
      await tx.pollImage.deleteMany({
        where: {
          pollId,
          id: {
            in: removedImages.map((image) => image.id),
          },
        },
      });
    }

    return removedImages.map((image) => image.objectKey);
  }

  private validatePollInput(input: SavePollDto): void {
    if (!input.title.trim()) {
      throw new BadRequestException('Poll title is required.');
    }

    this.validatePollPublicationSchedule({
      visibleFrom: this.normalizeScheduleDate(input.visibleFrom),
      votingStartsAt: this.normalizeScheduleDate(input.votingStartsAt),
      votingEndsAt: this.normalizeScheduleDate(input.votingEndsAt),
    });

    const elementIds = new Set<string>();
    for (const element of input.elements) {
      if (elementIds.has(element.id)) {
        throw new BadRequestException(`Duplicated element id: ${element.id}.`);
      }
      elementIds.add(element.id);

      if (!element.title.trim()) {
        throw new BadRequestException('Element title is required.');
      }

      const isOptionChoice = this.isOptionChoiceElement(element.type);
      if (isOptionChoice && element.options.length < 2) {
        throw new BadRequestException(`Element "${element.title}" needs at least two options.`);
      }

      if (!isOptionChoice && element.options.length > 0) {
        throw new BadRequestException(`Element "${element.title}" cannot have options.`);
      }

      const optionIds = new Set<string>();
      for (const option of element.options) {
        if (optionIds.has(option.id)) {
          throw new BadRequestException(`Duplicated option id: ${option.id}.`);
        }
        optionIds.add(option.id);

        if (!option.label.trim()) {
          throw new BadRequestException(`Option label is required in element "${element.title}".`);
        }
      }

      this.validateElementSettings(element);
    }

    this.validateImageReferences(input, elementIds);
  }

  private validatePollPublicationSchedule(schedule: PollPublicationScheduleData): void {
    const { visibleFrom, votingStartsAt, votingEndsAt } = schedule;
    if (votingStartsAt && votingEndsAt && votingStartsAt >= votingEndsAt) {
      throw new BadRequestException('Voting end date must be after the voting start date.');
    }

    if (visibleFrom && votingEndsAt && visibleFrom >= votingEndsAt) {
      throw new BadRequestException('Poll visibility date must be before the voting end date.');
    }
  }

  private validateImageReferences(input: SavePollDto, elementIds: Set<string>): void {
    const references = this.collectImageReferences(input);
    if (references.length > MAX_POLL_IMAGES) {
      throw new BadRequestException(`Polls can include at most ${MAX_POLL_IMAGES} images.`);
    }

    const seenImageIds = new Set<string>();
    for (const reference of references) {
      if (seenImageIds.has(reference.id)) {
        throw new BadRequestException('The same image cannot be embedded more than once.');
      }
      seenImageIds.add(reference.id);

      if (reference.elementId && !elementIds.has(reference.elementId)) {
        throw new BadRequestException('Poll image references an unknown element.');
      }
    }
  }

  private collectImageReferences(input: SavePollDto): PollImageReferenceData[] {
    const references: PollImageReferenceData[] = [
      ...this.normalizeImageReferences(
        input.descriptionImages,
        DbPollImagePlacement.POLL_DESCRIPTION,
        null,
      ),
    ];

    for (const element of input.elements) {
      references.push(
        ...this.normalizeImageReferences(
          element.descriptionImages,
          DbPollImagePlacement.ELEMENT_DESCRIPTION,
          element.id,
        ),
      );
    }

    return references;
  }

  private normalizeImageReferences(
    images: readonly PollImageReference[] | undefined,
    placement: 'POLL_DESCRIPTION' | 'ELEMENT_DESCRIPTION',
    elementId: string | null,
  ): PollImageReferenceData[] {
    if (!images?.length) {
      return [];
    }

    if (images.length > MAX_DESCRIPTION_IMAGES) {
      throw new BadRequestException(`Each description can include at most ${MAX_DESCRIPTION_IMAGES} images.`);
    }

    return images.map((image, position) => {
      if (!image.id.trim()) {
        throw new BadRequestException('Poll image id is required.');
      }

      const altText = this.cleanOptionalText(image.altText);
      const caption = this.cleanOptionalText(image.caption);
      return {
        id: image.id.trim(),
        placement,
        elementId,
        position,
        ...(altText ? { altText } : {}),
        ...(caption ? { caption } : {}),
      };
    });
  }

  private validateElementSettings(element: SavePollDto['elements'][number]): void {
    if (this.isGridElement(element.type)) {
      this.rejectUnexpectedSettings(element, ['grid']);
      const grid = element.settings?.grid;
      if (!grid) {
        throw new BadRequestException(`Element "${element.title}" needs grid settings.`);
      }

      this.validateSettingsOptions(grid.rows, `Rows in element "${element.title}"`, 1);
      this.validateSettingsOptions(grid.columns, `Columns in element "${element.title}"`, 2);
      return;
    }

    if (element.type === 'linearScale') {
      this.rejectUnexpectedSettings(element, ['linearScale']);
      const scale = element.settings?.linearScale;
      if (!scale) {
        throw new BadRequestException(`Element "${element.title}" needs linear scale settings.`);
      }

      if (!Number.isInteger(scale.min) || !LINEAR_SCALE_MIN_VALUES.includes(scale.min)) {
        throw new BadRequestException(`Element "${element.title}" linear scale must start at 0 or 1.`);
      }

      if (
        !Number.isInteger(scale.max) ||
        scale.max < LINEAR_SCALE_MAX_MINIMUM ||
        scale.max > LINEAR_SCALE_MAX_MAXIMUM ||
        scale.max <= scale.min
      ) {
        throw new BadRequestException(`Element "${element.title}" linear scale must end between 2 and 10.`);
      }
      return;
    }

    if (element.type === 'starRating') {
      this.rejectUnexpectedSettings(element, ['starRating']);
      const rating = element.settings?.starRating;
      if (!rating) {
        throw new BadRequestException(`Element "${element.title}" needs star rating settings.`);
      }

      if (!Number.isInteger(rating.max) || rating.max < STAR_RATING_MINIMUM || rating.max > STAR_RATING_MAXIMUM) {
        throw new BadRequestException(`Element "${element.title}" star rating must be between 3 and 10.`);
      }
      return;
    }

    if (element.type === 'scheduling') {
      this.rejectUnexpectedSettings(element, ['scheduling']);
      const scheduling = element.settings?.scheduling;
      if (!scheduling) {
        throw new BadRequestException(`Element "${element.title}" needs scheduling settings.`);
      }

      this.validateSchedulingSettings(element.title, scheduling);
      return;
    }

    this.rejectUnexpectedSettings(element, []);
  }

  private rejectUnexpectedSettings(
    element: SavePollDto['elements'][number],
    allowedSettings: (keyof PollElementSettings)[],
  ): void {
    if (!element.settings) {
      return;
    }

    const allowed = new Set<keyof PollElementSettings>(allowedSettings);
    for (const key of ['grid', 'linearScale', 'starRating', 'scheduling'] as const) {
      if (element.settings[key] && !allowed.has(key)) {
        throw new BadRequestException(`Element "${element.title}" has settings that do not match its type.`);
      }
    }
  }

  private validateSettingsOptions(options: readonly PollChoiceOption[], label: string, minimumSize: number): void {
    if (options.length < minimumSize) {
      throw new BadRequestException(`${label} must include at least ${minimumSize} item(s).`);
    }

    if (options.length > MAX_ELEMENT_OPTIONS) {
      throw new BadRequestException(`${label} must include at most ${MAX_ELEMENT_OPTIONS} items.`);
    }

    const optionIds = new Set<string>();
    for (const option of options) {
      if (optionIds.has(option.id)) {
        throw new BadRequestException(`Duplicated option id: ${option.id}.`);
      }
      optionIds.add(option.id);

      if (!option.label.trim()) {
        throw new BadRequestException(`${label} has an item without a label.`);
      }
    }
  }

  private validateSchedulingSettings(elementTitle: string, settings: PollSchedulingSettings): void {
    if (!settings.timezone.trim()) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling timezone is required.`);
    }

    this.validateSchedulingInteger(
      settings.durationMinutes,
      SCHEDULING_DURATION_MINIMUM,
      SCHEDULING_DURATION_MAXIMUM,
      `Element "${elementTitle}" scheduling duration is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.slotIntervalMinutes,
      SCHEDULING_INTERVAL_MINIMUM,
      SCHEDULING_INTERVAL_MAXIMUM,
      `Element "${elementTitle}" scheduling interval is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.bufferBeforeMinutes,
      0,
      SCHEDULING_BUFFER_MAXIMUM,
      `Element "${elementTitle}" scheduling buffer before is invalid.`,
    );
    this.validateSchedulingInteger(
      settings.bufferAfterMinutes,
      0,
      SCHEDULING_BUFFER_MAXIMUM,
      `Element "${elementTitle}" scheduling buffer after is invalid.`,
    );

    if (!SCHEDULING_INVITEE_MODES.includes(settings.inviteeMode)) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling invitee mode is invalid.`);
    }

    this.validateSchedulingInteger(
      settings.maxInvitees,
      settings.inviteeMode === 'none' ? 0 : 1,
      SCHEDULING_MAX_INVITEES,
      `Element "${elementTitle}" scheduling invitee limit is invalid.`,
    );

    if (settings.availability.length === 0) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling availability is required.`);
    }

    if (settings.availability.length > SCHEDULING_MAX_AVAILABILITY_WINDOWS) {
      throw new BadRequestException(`Element "${elementTitle}" scheduling availability has too many windows.`);
    }

    const windowIds = new Set<string>();
    const requiredMinutes =
      settings.bufferBeforeMinutes + settings.durationMinutes + settings.bufferAfterMinutes;

    for (const availability of settings.availability) {
      if (!availability.id.trim()) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability id is required.`);
      }

      if (windowIds.has(availability.id)) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability has duplicated ids.`);
      }
      windowIds.add(availability.id);

      this.parseDateAnswerValue(elementTitle, availability.date);
      const startMinutes = this.parseTimeAnswerValue(elementTitle, availability.startTime);
      const endMinutes = this.parseTimeAnswerValue(elementTitle, availability.endTime);
      if (endMinutes <= startMinutes) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability must end after it starts.`);
      }

      if (endMinutes - startMinutes < requiredMinutes) {
        throw new BadRequestException(`Element "${elementTitle}" scheduling availability is shorter than the meeting.`);
      }
    }
  }

  private validateSchedulingInteger(value: number, minimum: number, maximum: number, message: string): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new BadRequestException(message);
    }
  }

  private normalizeElementSettings(element: SavePollDto['elements'][number]): PollElementSettings | undefined {
    if (this.isGridElement(element.type) && element.settings?.grid) {
      return {
        grid: {
          rows: this.normalizeSettingsOptions(element.settings.grid.rows),
          columns: this.normalizeSettingsOptions(element.settings.grid.columns),
        },
      };
    }

    if (element.type === 'linearScale' && element.settings?.linearScale) {
      const minLabel = this.cleanOptionalText(element.settings.linearScale.minLabel);
      const maxLabel = this.cleanOptionalText(element.settings.linearScale.maxLabel);

      return {
        linearScale: {
          min: element.settings.linearScale.min,
          max: element.settings.linearScale.max,
          ...(minLabel ? { minLabel } : {}),
          ...(maxLabel ? { maxLabel } : {}),
        },
      };
    }

    if (element.type === 'starRating' && element.settings?.starRating) {
      return {
        starRating: {
          max: element.settings.starRating.max,
        },
      };
    }

    if (element.type === 'scheduling' && element.settings?.scheduling) {
      return {
        scheduling: this.normalizeSchedulingSettings(element.settings.scheduling),
      };
    }

    return undefined;
  }

  private normalizeSchedulingSettings(settings: PollSchedulingSettings): PollSchedulingSettings {
    const hostName = this.cleanOptionalText(settings.hostName);
    const location = this.cleanOptionalText(settings.location);
    const inviteeMode = settings.inviteeMode;

    return {
      ...(hostName ? { hostName } : {}),
      ...(location ? { location } : {}),
      timezone: settings.timezone.trim(),
      durationMinutes: settings.durationMinutes,
      slotIntervalMinutes: settings.slotIntervalMinutes,
      bufferBeforeMinutes: settings.bufferBeforeMinutes,
      bufferAfterMinutes: settings.bufferAfterMinutes,
      inviteeMode,
      maxInvitees: inviteeMode === 'none' ? 0 : settings.maxInvitees,
      availability: settings.availability.map((availability) => ({
        id: availability.id.trim(),
        date: availability.date.trim(),
        startTime: availability.startTime.trim(),
        endTime: availability.endTime.trim(),
      })),
    };
  }

  private normalizeSettingsOptions(options: readonly PollChoiceOption[]): PollChoiceOption[] {
    return options.map((option) => {
      const description = this.cleanOptionalText(option.description);
      return {
        id: option.id,
        label: option.label.trim(),
        ...(description ? { description } : {}),
      };
    });
  }

  private async resolvePollMetadata(input: SavePollDto, existing?: PollMetadataData): Promise<PollMetadataData> {
    const mode = this.toDbPollMode(input.mode ?? this.toContractPollMode(existing?.mode ?? DbPollMode.REGULAR));
    const cacicElectionPhase =
      mode === DbPollMode.CACIC_ELECTION
        ? this.toDbCacicElectionPhase(
            input.cacicElectionPhase ??
              (existing ? this.toContractCacicElectionPhase(existing.cacicElectionPhase) : undefined) ??
              'slateSubmission',
          )
        : null;
    const isCacicElectionVoting =
      mode === DbPollMode.CACIC_ELECTION && cacicElectionPhase === DbCacicElectionPhase.ELECTION;
    const votingStyle = isCacicElectionVoting
      ? DbPollVotingStyle.ANONYMOUS
      : this.toDbVotingStyle(input.votingStyle ?? 'secret');
    const voterEligibilitySource = isCacicElectionVoting
      ? DbPollVoterEligibilitySource.ENROLLMENT_LIST
      : this.toDbVoterEligibilitySource(
          input.voterEligibilitySource ?? 'authenticatedUsers',
        );
    const requireVerifiedUnespRole =
      !isCacicElectionVoting &&
      input.requireVerifiedUnespRole === true &&
      this.isComputerScienceEligibilitySource(voterEligibilitySource);
    const linkedEventId = isCacicElectionVoting ? null : this.cleanOptionalText(input.linkedEventId) ?? null;

    if (!linkedEventId) {
      if (this.isEventAttendanceEligibilitySource(voterEligibilitySource)) {
        throw new BadRequestException('A linked event is required when voting eligibility comes from attendance.');
      }

      return {
        mode,
        cacicElectionPhase,
        votingStyle,
        voterEligibilitySource,
        requireVerifiedUnespRole,
        linkedEventId: null,
        linkedEventName: null,
        linkedEventStartDate: null,
        linkedEventEndDate: null,
        linkedEventLocationDescription: null,
      };
    }

    if (existing?.linkedEventId === linkedEventId && existing.linkedEventName && existing.linkedEventStartDate && existing.linkedEventEndDate) {
      return {
        mode,
        cacicElectionPhase,
        votingStyle,
        voterEligibilitySource,
        requireVerifiedUnespRole,
        linkedEventId: existing.linkedEventId,
        linkedEventName: existing.linkedEventName,
        linkedEventStartDate: existing.linkedEventStartDate,
        linkedEventEndDate: existing.linkedEventEndDate,
        linkedEventLocationDescription: existing.linkedEventLocationDescription,
      };
    }

    const event = (await this.eventManager.listLinkableEvents()).find((item) => item.id === linkedEventId);
    if (!event) {
      throw new BadRequestException('Linked event was not found or is not available for new poll links.');
    }

    return {
      mode,
      cacicElectionPhase,
      votingStyle,
      voterEligibilitySource,
      requireVerifiedUnespRole,
      linkedEventId: event.id,
      linkedEventName: event.name,
      linkedEventStartDate: this.parseEventDate(event.startDate, 'startDate'),
      linkedEventEndDate: this.parseEventDate(event.endDate, 'endDate'),
      linkedEventLocationDescription: event.locationDescription ?? null,
    };
  }

  private resolvePollResultVisibility(
    input: SavePollDto,
    existing?: PollResultVisibilityData,
    metadata?: PollMetadataData,
  ): PollResultVisibilityData {
    if (metadata?.mode === DbPollMode.CACIC_ELECTION) {
      return {
        resultsPublic: metadata.cacicElectionPhase === DbCacicElectionPhase.ELECTION,
        resultsLive: false,
      };
    }

    const resultsPublic = input.resultsPublic ?? existing?.resultsPublic ?? false;
    return {
      resultsPublic,
      resultsLive: resultsPublic && (input.resultsLive ?? existing?.resultsLive ?? false),
    };
  }

  private resolvePollPublicationSchedule(
    input: SavePollDto,
    existing?: PollPublicationScheduleData,
  ): PollPublicationScheduleData {
    return {
      visibleFrom:
        input.visibleFrom === undefined ? existing?.visibleFrom ?? null : this.normalizeScheduleDate(input.visibleFrom),
      votingStartsAt:
        input.votingStartsAt === undefined
          ? existing?.votingStartsAt ?? null
          : this.normalizeScheduleDate(input.votingStartsAt),
      votingEndsAt:
        input.votingEndsAt === undefined ? existing?.votingEndsAt ?? null : this.normalizeScheduleDate(input.votingEndsAt),
    };
  }

  private normalizeScheduleDate(value: string | null | undefined): Date | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid poll schedule date.');
    }

    return setMilliseconds(setSeconds(date, 0), 0);
  }

  private resolvePollResponseOptions(
    input: SavePollDto,
    existing: PollResponseOptionsData | undefined,
    metadata: PollMetadataData,
  ): PollResponseOptionsData {
    if (metadata.mode === DbPollMode.CACIC_ELECTION && metadata.cacicElectionPhase === DbCacicElectionPhase.ELECTION) {
      return {
        allowResponseEditing: false,
        allowMultipleResponses: false,
      };
    }

    const allowMultipleResponses = input.allowMultipleResponses ?? existing?.allowMultipleResponses ?? false;
    const allowResponseEditing =
      metadata.votingStyle !== DbPollVotingStyle.ANONYMOUS &&
      !allowMultipleResponses &&
      (input.allowResponseEditing ?? existing?.allowResponseEditing ?? false);

    return {
      allowResponseEditing,
      allowMultipleResponses,
    };
  }

  private resolvePollDirectLink(
    input: SavePollDto,
    existing?: PollDirectLinkData,
    metadata?: PollMetadataData,
  ): PollDirectLinkData {
    if (metadata?.mode === DbPollMode.CACIC_ELECTION) {
      return {
        directLinkEnabled: false,
        directLinkToken: existing?.directLinkToken ?? null,
      };
    }

    const directLinkEnabled = input.directLinkEnabled ?? existing?.directLinkEnabled ?? false;
    const directLinkToken = directLinkEnabled
      ? existing?.directLinkToken ?? createUuidV7()
      : existing?.directLinkToken ?? null;

    return {
      directLinkEnabled,
      directLinkToken,
    };
  }

  private async replaceOrAppendEligibilityEnrollments(
    pollId: string,
    parsed: ParsedEligibilityEnrollments,
    mode: PollEligibilityMutationMode,
    createdById?: string,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    if (parsed.enrollmentNumbers.length === 0) {
      throw new BadRequestException('At least one valid enrollment number is required.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const replaced =
        mode === 'replace'
          ? await tx.pollEligibilityEnrollment.deleteMany({
              where: { pollId },
            })
          : { count: 0 };

      const created = await tx.pollEligibilityEnrollment.createMany({
        data: parsed.enrollmentNumbers.map((enrollmentNumber) => ({
          pollId,
          enrollmentNumber,
          createdById,
        })),
        skipDuplicates: true,
      });

      return {
        createdCount: created.count,
        replacedCount: replaced.count,
      };
    });

    const entries = await this.listEligibilityEnrollments(pollId);

    return {
      ...entries,
      createdCount: result.createdCount,
      duplicateCount: parsed.duplicateCount,
      existingCount: mode === 'append' ? parsed.enrollmentNumbers.length - result.createdCount : 0,
      invalidCount: parsed.invalidCount,
      replacedCount: result.replacedCount,
    };
  }

  private parseEligibilityImport(input: ImportPollEligibilityEnrollmentsDto): ParsedEligibilityEnrollments {
    switch (input.format) {
      case 'csv':
        return this.parseEligibilityCsvImport(input.content, input.selectedHeader);
      case 'txt':
        return this.parseEligibilityTxtImport(input.content);
    }
  }

  private parseEligibilityCsvImport(content: string, selectedHeader?: string): ParsedEligibilityEnrollments {
    const header = selectedHeader?.trim();
    if (!header) {
      throw new BadRequestException('A CSV header must be selected.');
    }

    const { headers, rows } = this.parseCsv(content);
    if (!headers.includes(header)) {
      throw new BadRequestException(`CSV header "${header}" was not found.`);
    }

    /* istanbul ignore next -- parseCsv only returns rows with every declared header key. */
    return this.normalizeEnrollmentNumbers(rows.map((row) => row[header] ?? ''));
  }

  private parseEligibilityTxtImport(content: string): ParsedEligibilityEnrollments {
    return this.normalizeEnrollmentNumbers(content.split(/\r?\n/));
  }

  private parseCsv(csvContent: string): { headers: string[]; rows: Record<string, string>[] } {
    const records: string[][] = [];
    const delimiter = this.detectCsvDelimiter(csvContent);
    let currentField = '';
    let currentRecord: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < csvContent.length; index += 1) {
      const char = csvContent[index];
      const nextChar = csvContent[index + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === delimiter && !inQuotes) {
        currentRecord.push(currentField);
        currentField = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          index += 1;
        }
        currentRecord.push(currentField);
        if (currentRecord.some((field) => field.trim().length > 0)) {
          records.push(currentRecord);
        }
        currentRecord = [];
        currentField = '';
        continue;
      }

      currentField += char;
    }

    if (inQuotes) {
      throw new BadRequestException('CSV file has an unclosed quoted field.');
    }

    currentRecord.push(currentField);
    if (currentRecord.some((field) => field.trim().length > 0)) {
      records.push(currentRecord);
    }

    const [headerRecord, ...dataRecords] = records;
    const headers = (headerRecord ?? []).map((header) => header.replace(/^\uFEFF/, '').trim());
    if (headers.length === 0) {
      throw new BadRequestException('CSV file must include a header row.');
    }

    const duplicateHeaders = new Set<string>();
    const seenHeaders = new Set<string>();
    for (const header of headers) {
      if (seenHeaders.has(header)) {
        duplicateHeaders.add(header);
      }
      seenHeaders.add(header);
    }
    if (duplicateHeaders.size > 0) {
      throw new BadRequestException(`CSV file has duplicate headers: ${[...duplicateHeaders].join(', ')}.`);
    }

    return {
      headers,
      rows: dataRecords.map((record, index) => {
        if (record.length !== headers.length) {
          throw new BadRequestException(`CSV row ${index + 2} has ${record.length} columns; expected ${headers.length}.`);
        }

        return headers.reduce<Record<string, string>>((row, currentHeader, headerIndex) => {
          /* istanbul ignore next -- record length is validated before reducing headers. */
          row[currentHeader] = record[headerIndex]?.trim() ?? '';
          return row;
        }, {});
      }),
    };
  }

  private detectCsvDelimiter(csvContent: string): string {
    /* istanbul ignore next -- String#split always returns a first segment. */
    const firstLine = csvContent.split(/\r?\n/, 1)[0] ?? '';
    const candidates = [',', ';', '\t'];
    return candidates.reduce((bestDelimiter, delimiter) => {
      const bestCount = firstLine.split(bestDelimiter).length;
      const candidateCount = firstLine.split(delimiter).length;
      return candidateCount > bestCount ? delimiter : bestDelimiter;
    }, ',');
  }

  private normalizeEnrollmentNumbers(rawValues: readonly unknown[]): ParsedEligibilityEnrollments {
    const enrollmentNumbers: string[] = [];
    const seen = new Set<string>();
    let duplicateCount = 0;
    let invalidCount = 0;

    for (const rawValue of rawValues) {
      const enrollmentNumber = this.normalizeEnrollmentNumber(rawValue);
      if (!enrollmentNumber) {
        if (this.hasNonEmptyRawValue(rawValue)) {
          invalidCount += 1;
        }
        continue;
      }

      if (seen.has(enrollmentNumber)) {
        duplicateCount += 1;
        continue;
      }

      seen.add(enrollmentNumber);
      enrollmentNumbers.push(enrollmentNumber);
    }

    return {
      enrollmentNumbers,
      duplicateCount,
      invalidCount,
    };
  }

  private normalizeEnrollmentNumber(rawValue: unknown): string | null {
    const value =
      typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? String(rawValue)
        : typeof rawValue === 'string'
          ? rawValue
          : '';
    const normalized = value.replace(/^\uFEFF/, '').trim();
    if (!normalized || normalized.length > MAX_ENROLLMENT_NUMBER_LENGTH) {
      return null;
    }

    return normalized;
  }

  private normalizeDirectLinkToken(rawValue: unknown): string {
    const token = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
    if (!UUID_V7_PATTERN.test(token)) {
      throw new NotFoundException('Poll not found.');
    }

    return token;
  }

  private hasNonEmptyRawValue(rawValue: unknown): boolean {
    return typeof rawValue === 'string'
      ? rawValue.trim().length > 0
      : typeof rawValue === 'number' && Number.isFinite(rawValue);
  }

  private toPollResultsVoter(user: {
    id: string;
    name: string | null;
    preferredUsername: string | null;
    email: string | null;
    claims: Prisma.JsonValue | null;
  }): PollResultsVoter {
    const claims = this.isRecord(user.claims) ? user.claims : {};
    const enrollmentNumber = this.readEnrollmentNumberFromClaims(claims);
    const unespRoles = this.readClaimValuesFromClaims(claims, ['unesp_role', 'unespRole'])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      userId: user.id,
      name: user.name ?? this.readStringClaimFromClaims(claims, 'name'),
      preferredUsername: user.preferredUsername ?? this.readStringClaimFromClaims(claims, 'preferred_username'),
      email: user.email ?? this.readStringClaimFromClaims(claims, 'email'),
      ...(unespRoles.length > 0 ? { unespRole: [...new Set(unespRoles)].join(', ') } : {}),
      ...(enrollmentNumber ? { enrollmentNumber } : {}),
    };
  }

  private readStringClaimFromClaims(claims: Record<string, unknown>, claimName: string): string | undefined {
    const value = claims[claimName];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private async toEligibilityEnrollmentList(
    records: EligibilityEnrollmentRecord[],
  ): Promise<PollEligibilityEnrollmentList> {
    const peopleByEnrollmentNumber = await this.lookupAccountManagerPeople(
      records.map((record) => record.enrollmentNumber),
    );

    return {
      totalCount: records.length,
      entries: records.map((record) => ({
        pollId: record.pollId,
        enrollmentNumber: record.enrollmentNumber,
        createdAt: record.createdAt.toISOString(),
        people: peopleByEnrollmentNumber.get(record.enrollmentNumber) ?? [],
      })),
    };
  }

  private async lookupAccountManagerPeople(enrollmentNumbers: string[]): Promise<Map<string, AccountManagerPerson[]>> {
    const peopleByEnrollmentNumber = new Map<string, AccountManagerPerson[]>();
    if (enrollmentNumbers.length === 0) {
      return peopleByEnrollmentNumber;
    }

    try {
      const people = await this.accountManager.lookupPeopleByEnrollmentNumbers(enrollmentNumbers);
      for (const person of people) {
        const normalizedEnrollmentNumber = this.normalizeEnrollmentNumber(person.enrollmentNumber ?? '');
        if (!normalizedEnrollmentNumber) {
          continue;
        }

        const existingPeople = peopleByEnrollmentNumber.get(normalizedEnrollmentNumber) ?? [];
        peopleByEnrollmentNumber.set(normalizedEnrollmentNumber, [...existingPeople, person]);
      }
    } catch {
      this.logger.warn('Could not enrich eligibility enrollments with Account Manager user data.');
    }

    return peopleByEnrollmentNumber;
  }

  private async assertPollExists(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { id: true },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
  }

  private async assertPublicCacicElectionSlatePollReadable(pollId: string): Promise<void> {
    const now = new Date();
    const poll = await this.prisma.poll.findFirst({
      where: {
        id: pollId,
        mode: DbPollMode.CACIC_ELECTION,
        ...this.publicReadablePollWhere(now),
      },
      select: { id: true },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
  }

  private async assertCacicElectionSlateSubmissionOpen(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        mode: true,
        cacicElectionPhase: true,
        status: true,
        visibleFrom: true,
        votingStartsAt: true,
        votingEndsAt: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    if (poll.mode !== DbPollMode.CACIC_ELECTION || poll.cacicElectionPhase !== DbCacicElectionPhase.SLATE_SUBMISSION) {
      throw new BadRequestException('This poll is not accepting CACiC election slate submissions.');
    }

    if (!this.isPollVotingOpen(poll, new Date())) {
      throw new ForbiddenException('CACiC election slate submissions are closed.');
    }
  }

  private async assertCacicElectionPollExists(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        mode: true,
      },
    });

    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }

    if (poll.mode !== DbPollMode.CACIC_ELECTION) {
      throw new BadRequestException('This poll is not a CACiC election.');
    }
  }

  private async assertCacicElectionSlateBelongsToPoll(
    tx: Prisma.TransactionClient,
    pollId: string,
    slateId: string,
  ): Promise<void> {
    const slate = await tx.cacicElectionSlate.findFirst({
      where: {
        id: slateId,
        pollId,
      },
      select: { id: true },
    });

    if (!slate) {
      throw new NotFoundException('Slate not found.');
    }
  }

  private cacicElectionSlateInclude(): Prisma.CacicElectionSlateInclude {
    return {
      members: {
        orderBy: {
          position: 'asc',
        },
      },
      submittedBy: {
        select: {
          id: true,
          name: true,
          preferredUsername: true,
          email: true,
        },
      },
    };
  }

  private async replaceCacicElectionSlateMembers(
    tx: Prisma.TransactionClient,
    slateId: string,
    members: readonly NormalizedCacicElectionSlateMember[],
  ): Promise<void> {
    await tx.cacicElectionSlateMember.deleteMany({ where: { slateId } });
    await tx.cacicElectionSlateMember.createMany({
      data: members.map((member, position) => ({
        slateId,
        fullName: member.fullName,
        enrollmentNumber: member.enrollmentNumber,
        role: member.role,
        customRole: member.customRole,
        isRepresentative: member.isRepresentative,
        identifierType: member.identifierType,
        identifierValue: member.identifierValue,
        position,
      })),
    });
  }

  private normalizeSlateName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException('Slate name is required.');
    }

    return name;
  }

  private async normalizeCacicElectionSlateMembers(
    input: readonly CacicElectionSlateMemberInput[],
  ): Promise<NormalizedCacicElectionSlateMember[]> {
    if (input.length < MIN_CACIC_ELECTION_SLATE_MEMBERS) {
      throw new BadRequestException('A CACiC election slate must include at least 6 members.');
    }

    const members = input.map((member) => this.normalizeCacicElectionSlateMember(member));
    const representatives = members.filter((member) => member.isRepresentative);
    if (representatives.length !== 1) {
      throw new BadRequestException('A CACiC election slate must have exactly one representative.');
    }

    for (const requiredRole of CACIC_ELECTION_REQUIRED_ROLES) {
      const count = members.filter((member) => member.role === requiredRole).length;
      if (count === 0) {
        throw new BadRequestException('A CACiC election slate must include all required roles.');
      }

      if (
        (requiredRole === DbCacicElectionSlateMemberRole.PRESIDENT ||
          requiredRole === DbCacicElectionSlateMemberRole.VICE_PRESIDENT) &&
        count !== 1
      ) {
        throw new BadRequestException('A CACiC election slate must have exactly one president and one vice-president.');
      }
    }

    await this.lookupSlateMembersBestEffort(members);
    return members;
  }

  private normalizeCacicElectionSlateMember(
    member: CacicElectionSlateMemberInput,
  ): NormalizedCacicElectionSlateMember {
    const fullName = member.fullName.trim();
    if (!fullName) {
      throw new BadRequestException('Slate member full name is required.');
    }

    const role = this.toDbCacicElectionSlateMemberRole(member.role);
    const customRole = this.cleanOptionalText(member.customRole) ?? null;
    if (role === DbCacicElectionSlateMemberRole.OTHER && !customRole) {
      throw new BadRequestException('Custom role is required for other slate member roles.');
    }

    if (role !== DbCacicElectionSlateMemberRole.OTHER && customRole) {
      throw new BadRequestException('Custom role is only allowed for other slate member roles.');
    }

    const identifierType = this.toDbCacicElectionSlateMemberIdentifierType(member.identifierType);
    return {
      id: member.id,
      fullName,
      enrollmentNumber: this.normalizeEnrollmentNumber(member.enrollmentNumber ?? '') ?? null,
      role,
      customRole,
      isRepresentative: member.isRepresentative,
      identifierType,
      identifierValue: this.normalizeCacicElectionSlateMemberIdentifier(identifierType, member.identifierValue),
    };
  }

  private normalizeCacicElectionSlateMemberIdentifier(
    type: DbCacicElectionSlateMemberIdentifierType,
    value: string,
  ): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException('Slate member identifier is required.');
    }

    switch (type) {
      case DbCacicElectionSlateMemberIdentifierType.CPF: {
        const digits = this.onlyDigits(trimmed);
        if (digits.length !== 11) {
          throw new BadRequestException('Slate member CPF is invalid.');
        }

        return digits;
      }
      case DbCacicElectionSlateMemberIdentifierType.PHONE: {
        const digits = this.onlyDigits(trimmed);
        if (digits.length < 10 || digits.length > 13) {
          throw new BadRequestException('Slate member phone is invalid.');
        }

        return digits;
      }
      case DbCacicElectionSlateMemberIdentifierType.EMAIL: {
        const email = trimmed.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new BadRequestException('Slate member email is invalid.');
        }

        return email;
      }
    }
  }

  private async lookupSlateMembersBestEffort(
    members: readonly NormalizedCacicElectionSlateMember[],
  ): Promise<void> {
    try {
      await this.accountManager.lookupPeopleByIdentifiers(
        members.map((member, index) => ({
          requestId: `member-${index}`,
          identifierType: this.toContractCacicElectionSlateMemberIdentifierType(member.identifierType),
          identifierValue: member.identifierValue,
        })),
      );
    } catch {
      this.logger.warn('Could not verify CACiC election slate member identifiers with Account Manager.');
    }
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private cacicElectionSlateOptionId(slateId: string): string {
    return `slate:${slateId}`;
  }

  private async ensureVotingAllowed(poll: PollEligibilityRecord, user: AuthenticatedVoter): Promise<void> {
    switch (poll.voterEligibilitySource) {
      case DbPollVoterEligibilitySource.AUTHENTICATED_USERS:
        return;
      case DbPollVoterEligibilitySource.UNESP_USERS:
        this.ensureUnespUserVotingAllowed(user);
        return;
      case DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS:
        await this.ensureComputerScienceStudentVotingAllowed(poll, user);
        return;
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE:
        await this.ensureEventAttendanceVotingAllowed(poll, user);
        return;
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS:
        await this.ensureEventAttendanceVotingAllowed(poll, user);
        this.ensureUnespUserVotingAllowed(user);
        return;
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS:
        await this.ensureEventAttendanceVotingAllowed(poll, user);
        await this.ensureComputerScienceStudentVotingAllowed(poll, user);
        return;
      case DbPollVoterEligibilitySource.ENROLLMENT_LIST:
        await this.ensureEnrollmentListVotingAllowed(poll, user);
        return;
    }

    throw new ForbiddenException('Voting is not allowed for this poll.');
  }

  private async ensureEventAttendanceVotingAllowed(poll: PollEligibilityRecord, user: AuthenticatedVoter): Promise<void> {
    if (!poll.linkedEventId) {
      throw new BadRequestException('Poll is not linked to an Event Manager event.');
    }

    const hasAttendance = await this.eventManager.hasAttendance(poll.linkedEventId, user.sub);
    if (!hasAttendance) {
      throw new ForbiddenException('Voting is restricted to users with registered attendance for the linked event.');
    }
  }

  private async ensureEnrollmentListVotingAllowed(poll: PollEligibilityRecord, user: AuthenticatedVoter): Promise<void> {
    const enrollmentNumber = this.readUserEnrollmentNumber(user);
    if (!enrollmentNumber) {
      throw new ForbiddenException('Voting is restricted to users with an enrollment number.');
    }

    const eligibleEnrollment = await this.prisma.pollEligibilityEnrollment.findUnique({
      where: {
        pollId_enrollmentNumber: {
          pollId: poll.id,
          enrollmentNumber,
        },
      },
      select: {
        enrollmentNumber: true,
      },
    });

    if (!eligibleEnrollment) {
      throw new ForbiddenException('Voting is restricted to users in the enrollment eligibility list.');
    }
  }

  private ensureUnespUserVotingAllowed(user: AuthenticatedVoter): void {
    if (!this.hasUnespEmail(user)) {
      throw new ForbiddenException('Voting is restricted to users with an Unesp email.');
    }
  }

  private async ensureComputerScienceStudentVotingAllowed(
    poll: PollEligibilityRecord,
    user: AuthenticatedVoter,
  ): Promise<void> {
    if (!this.hasUndergraduateUnespRole(user)) {
      throw new ForbiddenException('Voting is restricted to undergraduate Unesp students.');
    }

    const enrollmentNumber = this.readUserEnrollmentNumber(user);
    if (!this.hasComputerScienceEnrollmentPattern(enrollmentNumber)) {
      throw new ForbiddenException('Voting is restricted to computer science students.');
    }

    if (
      (await this.shouldRequireVerifiedUnespRole(poll)) &&
      !this.hasVerifiedUnespRole(user)
    ) {
      throw new ForbiddenException('Voting is restricted to users with a verified Unesp role.');
    }
  }

  private async shouldRequireVerifiedUnespRole(
    poll: PollEligibilityRecord,
  ): Promise<boolean> {
    if (!poll.requireVerifiedUnespRole) {
      return false;
    }

    return !(
      (await this.featureFlags?.isUndergraduateUnespRoleVerificationDisabled()) ??
      false
    );
  }

  private readUserEnrollmentNumber(user: AuthenticatedPrincipal): string | null {
    return this.readEnrollmentNumberFromClaims(user.claims);
  }

  private readEnrollmentNumberFromClaims(claims: Record<string, unknown>): string | null {
    for (const value of this.readClaimValuesFromClaims(claims, [
      'enrollmentNumber',
      'enrollment_number',
      'academicId',
      'academic_id',
    ])) {
      const enrollmentNumber = this.normalizeEnrollmentNumber(value);
      if (enrollmentNumber) {
        return enrollmentNumber;
      }
    }

    return null;
  }

  private hasUnespEmail(user: AuthenticatedPrincipal): boolean {
    return this.readUserEmails(user).some((email) => email.endsWith(UNESP_EMAIL_DOMAIN));
  }

  private readUserEmails(user: AuthenticatedPrincipal): string[] {
    const emails = [user.email, ...this.readClaimValues(user, ['email', 'secondary_emails', 'secondaryEmails'])]
      .filter((value): value is string => typeof value === 'string')
      .flatMap((email) => this.parseStringList(email))
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    return [...new Set(emails)];
  }

  private hasUndergraduateUnespRole(user: AuthenticatedPrincipal): boolean {
    return this.readClaimValues(user, ['unesp_role', 'unespRole'])
      .filter((value): value is string => typeof value === 'string')
      .some((role) => role.trim() === UNDERGRADUATE_UNESP_ROLE);
  }

  private hasComputerScienceEnrollmentPattern(enrollmentNumber: string | null): boolean {
    const normalizedEnrollmentNumber = enrollmentNumber?.replace(/\D/g, '');
    if (!normalizedEnrollmentNumber || normalizedEnrollmentNumber.length < 4) {
      return false;
    }

    return normalizedEnrollmentNumber.substring(2, 4) === COMPUTER_SCIENCE_COURSE_CODE;
  }

  private hasVerifiedUnespRole(user: AuthenticatedPrincipal): boolean {
    return this.readClaimValues(user, [
      'unespRoleVerified',
      'isUnespRoleVerified',
      'unesp_role_verified',
      'is_unesp_role_verified',
    ]).some((value) => this.readBooleanValue(value));
  }

  private readClaimValues(user: AuthenticatedPrincipal, claimNames: readonly string[]): unknown[] {
    return this.readClaimValuesFromClaims(user.claims, claimNames);
  }

  private readClaimValuesFromClaims(claims: Record<string, unknown>, claimNames: readonly string[]): unknown[] {
    const values: unknown[] = [];
    const attributes = this.isRecord(claims['attributes']) ? (claims['attributes'] as Record<string, unknown>) : undefined;

    for (const claimName of claimNames) {
      values.push(...this.flattenClaimValue(claims[claimName]));
      if (attributes) {
        values.push(...this.flattenClaimValue(attributes[claimName]));
      }
    }

    return values;
  }

  private flattenClaimValue(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.flattenClaimValue(item));
    }

    if (typeof value !== 'string') {
      return value === undefined ? [] : [value];
    }

    return this.parseStringList(value);
  }

  private parseStringList(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        /* istanbul ignore else -- valid JSON that starts with "[" parses as an array. */
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        return [trimmed];
      }
    }

    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }

  private readBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    return typeof value === 'string' && value.trim().toLowerCase() === 'true';
  }

  private validateResponse(poll: PollRecord, input: SubmitPollResponseDto): PollResponseAnswer[] {
    const answersByElementId = new Map(input.answers.map((answer) => [answer.elementId, answer.value]));
    const elementIds = new Set(poll.elements.map((element) => element.id));
    const normalizedAnswers: PollResponseAnswer[] = [];

    for (const answer of input.answers) {
      if (!elementIds.has(answer.elementId)) {
        throw new BadRequestException(`Unknown element id: ${answer.elementId}.`);
      }
    }

    for (const element of poll.elements) {
      const rawValue = answersByElementId.get(element.id) ?? null;
      const value = this.normalizeAnswer(element, rawValue);

      if (element.required && this.isEmptyAnswer(value)) {
        throw new BadRequestException(`Required element was not answered: ${element.title}.`);
      }

      if (!this.isEmptyAnswer(value)) {
        normalizedAnswers.push({
          elementId: element.id,
          value,
        });
      }
    }

    return normalizedAnswers;
  }

  private normalizeAnswer(element: ElementRecord, rawValue: PollAnswerValue): PollResponseAnswer['value'] {
    switch (this.toContractElementType(element.type)) {
      case 'section':
      case 'statement':
        return null;
      case 'shortText':
      case 'longText':
        return typeof rawValue === 'string' ? rawValue.trim() : null;
      case 'singleChoice':
      case 'selectionDropdown':
        return this.normalizeSingleChoiceAnswer(element, rawValue);
      case 'multipleChoice':
        return this.normalizeMultipleChoiceAnswer(element, rawValue);
      case 'singleSelectionGrid':
        return this.normalizeSingleSelectionGridAnswer(element, rawValue);
      case 'multipleSelectionGrid':
        return this.normalizeMultipleSelectionGridAnswer(element, rawValue);
      case 'linearScale':
        return this.normalizeBoundedNumberAnswer(element, rawValue);
      case 'starRating':
        return this.normalizeStarRatingAnswer(element, rawValue);
      case 'date':
        return this.normalizeDateAnswer(element, rawValue);
      case 'time':
        return this.normalizeTimeAnswer(element, rawValue);
      case 'scheduling':
        return this.normalizeSchedulingAnswer(element, rawValue);
    }
  }

  private normalizeSingleChoiceAnswer(element: ElementRecord, rawValue: PollAnswerValue): string | null {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null;
    }

    const optionIds = new Set(element.options.map((option) => option.id));
    if (!optionIds.has(rawValue)) {
      throw new BadRequestException(`Invalid option for element: ${element.title}.`);
    }

    return rawValue;
  }

  private normalizeMultipleChoiceAnswer(element: ElementRecord, rawValue: PollAnswerValue): string[] | null {
    if (!Array.isArray(rawValue)) {
      return null;
    }

    const optionIds = new Set(element.options.map((option) => option.id));
    const selected = [...new Set(rawValue.filter((value) => typeof value === 'string' && value.trim()))];

    for (const optionId of selected) {
      if (!optionIds.has(optionId)) {
        throw new BadRequestException(`Invalid option for element: ${element.title}.`);
      }
    }

    return selected.length > 0 ? selected : null;
  }

  private normalizeSingleSelectionGridAnswer(
    element: ElementRecord,
    rawValue: PollAnswerValue,
  ): Record<string, string> | null {
    const grid = this.readElementSettings(element).grid;
    if (!grid || !this.isRecord(rawValue)) {
      return null;
    }

    const rowIds = new Set(grid.rows.map((row) => row.id));
    const columnIds = new Set(grid.columns.map((column) => column.id));
    const selected: Record<string, string> = {};

    for (const [rowId, columnId] of Object.entries(rawValue)) {
      if (!rowIds.has(rowId)) {
        throw new BadRequestException(`Invalid row for element: ${element.title}.`);
      }

      if (typeof columnId !== 'string' || !columnId.trim()) {
        continue;
      }

      if (!columnIds.has(columnId)) {
        throw new BadRequestException(`Invalid column for element: ${element.title}.`);
      }

      selected[rowId] = columnId;
    }

    this.ensureRequiredGridRows(element, grid.rows, selected);
    return Object.keys(selected).length > 0 ? selected : null;
  }

  private normalizeMultipleSelectionGridAnswer(
    element: ElementRecord,
    rawValue: PollAnswerValue,
  ): Record<string, string[]> | null {
    const grid = this.readElementSettings(element).grid;
    if (!grid || !this.isRecord(rawValue)) {
      return null;
    }

    const rowIds = new Set(grid.rows.map((row) => row.id));
    const columnIds = new Set(grid.columns.map((column) => column.id));
    const selected: Record<string, string[]> = {};

    for (const [rowId, columnValues] of Object.entries(rawValue)) {
      if (!rowIds.has(rowId)) {
        throw new BadRequestException(`Invalid row for element: ${element.title}.`);
      }

      if (!Array.isArray(columnValues)) {
        continue;
      }

      const selectedColumns = [...new Set(columnValues.filter((value) => typeof value === 'string' && value.trim()))];
      for (const columnId of selectedColumns) {
        if (!columnIds.has(columnId)) {
          throw new BadRequestException(`Invalid column for element: ${element.title}.`);
        }
      }

      if (selectedColumns.length > 0) {
        selected[rowId] = selectedColumns;
      }
    }

    this.ensureRequiredGridRows(element, grid.rows, selected);
    return Object.keys(selected).length > 0 ? selected : null;
  }

  private ensureRequiredGridRows(
    element: ElementRecord,
    rows: readonly PollChoiceOption[],
    selected: Record<string, string | string[]>,
  ): void {
    if (!element.required) {
      return;
    }

    const unansweredRow = rows.find((row) => {
      const value = selected[row.id];
      return value === undefined || (Array.isArray(value) && value.length === 0) || value === '';
    });

    if (unansweredRow) {
      throw new BadRequestException(`Required grid row was not answered: ${unansweredRow.label}.`);
    }
  }

  private normalizeBoundedNumberAnswer(element: ElementRecord, rawValue: PollAnswerValue): number | null {
    const scale = this.readElementSettings(element).linearScale;
    const value = this.parseNumberAnswer(element, rawValue);
    if (value === null) {
      return null;
    }

    if (!scale || value < scale.min || value > scale.max) {
      throw new BadRequestException(`Invalid value for element: ${element.title}.`);
    }

    return value;
  }

  private normalizeStarRatingAnswer(element: ElementRecord, rawValue: PollAnswerValue): number | null {
    const rating = this.readElementSettings(element).starRating;
    const value = this.parseNumberAnswer(element, rawValue);
    if (value === null) {
      return null;
    }

    if (!rating || value < 1 || value > rating.max) {
      throw new BadRequestException(`Invalid rating for element: ${element.title}.`);
    }

    return value;
  }

  private parseNumberAnswer(element: ElementRecord, rawValue: PollAnswerValue): number | null {
    if (rawValue === null || rawValue === '') {
      return null;
    }

    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' && rawValue.trim()
          ? Number(rawValue)
          : Number.NaN;

    if (!Number.isInteger(value)) {
      throw new BadRequestException(`Invalid number for element: ${element.title}.`);
    }

    return value;
  }

  private normalizeDateAnswer(element: ElementRecord, rawValue: PollAnswerValue): string | null {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null;
    }

    const value = rawValue.trim();
    this.parseDateAnswerValue(element.title, value);
    return value;
  }

  private normalizeTimeAnswer(element: ElementRecord, rawValue: PollAnswerValue): string | null {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null;
    }

    const value = rawValue.trim();
    this.parseTimeAnswerValue(element.title, value);
    return value;
  }

  private normalizeSchedulingAnswer(element: ElementRecord, rawValue: PollAnswerValue): PollResponseAnswer['value'] {
    const settings = this.readElementSettings(element).scheduling;
    if (!settings || !this.isRecord(rawValue)) {
      return null;
    }

    const slotId = typeof rawValue['slotId'] === 'string' ? rawValue['slotId'].trim() : '';
    if (!slotId) {
      return null;
    }

    const validSlotIds = new Set(this.buildSchedulingSlots(settings).map((slot) => slot.id));
    if (!validSlotIds.has(slotId)) {
      throw new BadRequestException(`Invalid scheduling slot for element: ${element.title}.`);
    }

    return {
      slotId,
      invitees: this.normalizeSchedulingInvitees(element, settings, rawValue['invitees']),
    };
  }

  private normalizeSchedulingInvitees(
    element: ElementRecord,
    settings: PollSchedulingSettings,
    rawInvitees: unknown,
  ): PollSchedulingInvitee[] {
    if (settings.inviteeMode === 'none') {
      return [];
    }

    if (rawInvitees !== undefined && !Array.isArray(rawInvitees)) {
      throw new BadRequestException(`Invalid invitees for element: ${element.title}.`);
    }

    const invitees = (Array.isArray(rawInvitees) ? rawInvitees : [])
      .map((rawInvitee) => this.normalizeSchedulingInvitee(element, rawInvitee))
      .filter((invitee): invitee is PollSchedulingInvitee => invitee !== null);

    if (invitees.length > settings.maxInvitees) {
      throw new BadRequestException(`Too many invitees for element: ${element.title}.`);
    }

    if (settings.inviteeMode === 'required' && invitees.length === 0) {
      throw new BadRequestException(`At least one invitee is required for element: ${element.title}.`);
    }

    return invitees;
  }

  private normalizeSchedulingInvitee(element: ElementRecord, rawInvitee: unknown): PollSchedulingInvitee | null {
    if (!this.isRecord(rawInvitee)) {
      return null;
    }

    const name = typeof rawInvitee['name'] === 'string' ? rawInvitee['name'].trim() : '';
    const email = typeof rawInvitee['email'] === 'string' ? rawInvitee['email'].trim() : '';
    if (!name && !email) {
      return null;
    }

    if (!name) {
      throw new BadRequestException(`Invitee name is required for element: ${element.title}.`);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException(`Invitee email is invalid for element: ${element.title}.`);
    }

    return {
      name,
      ...(email ? { email } : {}),
    };
  }

  private buildSchedulingSlots(settings: PollSchedulingSettings): { id: string }[] {
    const slots: { id: string }[] = [];
    const requiredMinutes =
      settings.bufferBeforeMinutes + settings.durationMinutes + settings.bufferAfterMinutes;

    for (const availability of settings.availability) {
      const windowStart = this.parseTimeAnswerValue('scheduling availability', availability.startTime);
      const windowEnd = this.parseTimeAnswerValue('scheduling availability', availability.endTime);
      const firstStart = windowStart + settings.bufferBeforeMinutes;
      const lastStart = windowEnd - settings.durationMinutes - settings.bufferAfterMinutes;

      if (windowEnd - windowStart < requiredMinutes) {
        continue;
      }

      for (
        let startMinutes = firstStart;
        startMinutes <= lastStart;
        startMinutes += settings.slotIntervalMinutes
      ) {
        slots.push({ id: this.schedulingSlotId(availability, startMinutes) });
      }
    }

    return slots;
  }

  private schedulingSlotId(availability: PollSchedulingAvailabilityWindow, startMinutes: number): string {
    return `${availability.id}:${this.formatTimeMinutes(startMinutes)}`;
  }

  private parseDateAnswerValue(elementTitle: string, value: string): void {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException(`Invalid date for element: ${elementTitle}.`);
    }

    const [, rawYear, rawMonth, rawDay] = match;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new BadRequestException(`Invalid date for element: ${elementTitle}.`);
    }
  }

  private parseTimeAnswerValue(elementTitle: string, value: string): number {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException(`Invalid time for element: ${elementTitle}.`);
    }

    return this.timeToMinutes(value);
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private formatTimeMinutes(value: number): string {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private isEmptyAnswer(value: PollResponseAnswer['value']): boolean {
    return (
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (this.isRecord(value) && Object.keys(value).length === 0)
    );
  }

  private readElementSettings(element: ElementRecord): PollElementSettings {
    return this.isRecord(element.settings) ? (element.settings as PollElementSettings) : {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toContractPoll(poll: PollRecord, options: PollContractOptions = {}): Poll {
    const pollImages = poll.images ?? [];
    const descriptionImages = this.toContractImages(
      pollImages.filter((image) => image.placement === DbPollImagePlacement.POLL_DESCRIPTION),
      options,
    );
    const imagesByElementId = new Map<string, ImageRecord[]>();
    for (const image of pollImages) {
      if (image.placement !== DbPollImagePlacement.ELEMENT_DESCRIPTION || !image.elementId) {
        continue;
      }

      imagesByElementId.set(image.elementId, [...(imagesByElementId.get(image.elementId) ?? []), image]);
    }

    return {
      id: poll.id,
      title: poll.title,
      description: poll.description ?? undefined,
      ...(descriptionImages.length > 0 ? { descriptionImages } : {}),
      status: this.toContractStatus(poll.status),
      mode: this.toContractPollMode(poll.mode),
      cacicElectionPhase: this.toContractCacicElectionPhase(poll.cacicElectionPhase),
      votingStyle: this.toContractVotingStyle(poll.votingStyle),
      voterEligibilitySource: this.toContractVoterEligibilitySource(poll.voterEligibilitySource),
      requireVerifiedUnespRole: poll.requireVerifiedUnespRole,
      directLinkEnabled: poll.directLinkEnabled,
      ...(options.includeDirectLinkToken && poll.directLinkToken ? { directLinkToken: poll.directLinkToken } : {}),
      resultsPublic: poll.resultsPublic,
      resultsLive: poll.resultsLive,
      allowResponseEditing: poll.allowResponseEditing,
      allowMultipleResponses: poll.allowMultipleResponses,
      linkedEvent: this.toContractLinkedEvent(poll),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
      publishedAt: poll.publishedAt?.toISOString(),
      visibleFrom: poll.visibleFrom?.toISOString(),
      votingStartsAt: poll.votingStartsAt?.toISOString(),
      votingEndsAt: poll.votingEndsAt?.toISOString(),
      elements: poll.elements.map((element) =>
        this.toContractElement(element, imagesByElementId.get(element.id) ?? [], options),
      ),
    };
  }

  private toContractElement(
    element: ElementRecord,
    images: ImageRecord[],
    options: PollContractOptions,
  ): PollElement {
    const settings = this.toContractElementSettings(element);
    const descriptionImages = this.toContractImages(images, options);

    return {
      id: element.id,
      type: this.toContractElementType(element.type),
      title: element.title,
      description: element.description ?? undefined,
      ...(descriptionImages.length > 0 ? { descriptionImages } : {}),
      required: element.required,
      options: element.options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? undefined,
      })),
      ...(settings ? { settings } : {}),
    };
  }

  private toContractImages(images: ImageRecord[], options: PollContractOptions = {}): PollImage[] {
    return [...images]
      .sort((left, right) => left.position - right.position)
      .map((image) => ({
        id: image.id,
        url: options.imageDirectLinkToken
          ? `/api/polls/direct/${encodeURIComponent(options.imageDirectLinkToken)}/images/${encodeURIComponent(image.id)}`
          : `/api/polls/${encodeURIComponent(image.pollId)}/images/${encodeURIComponent(image.id)}`,
        width: image.width,
        height: image.height,
        altText: image.altText ?? undefined,
        caption: image.caption ?? undefined,
      }));
  }

  private toContractElementSettings(element: ElementRecord): PollElementSettings | undefined {
    const settings = this.readElementSettings(element);
    const type = this.toContractElementType(element.type);

    if (this.isGridElement(type) && settings.grid) {
      return { grid: settings.grid };
    }

    if (type === 'linearScale' && settings.linearScale) {
      return { linearScale: settings.linearScale };
    }

    if (type === 'starRating' && settings.starRating) {
      return { starRating: settings.starRating };
    }

    if (type === 'scheduling' && settings.scheduling) {
      return { scheduling: settings.scheduling };
    }

    return undefined;
  }

  private toContractLinkedEvent(poll: {
    linkedEventId: string | null;
    linkedEventName: string | null;
    linkedEventStartDate: Date | null;
    linkedEventEndDate: Date | null;
    linkedEventLocationDescription: string | null;
  }): PollLinkedEvent | undefined {
    if (!poll.linkedEventId || !poll.linkedEventName || !poll.linkedEventStartDate || !poll.linkedEventEndDate) {
      return undefined;
    }

    return {
      id: poll.linkedEventId,
      name: poll.linkedEventName,
      startDate: poll.linkedEventStartDate.toISOString(),
      endDate: poll.linkedEventEndDate.toISOString(),
      locationDescription: poll.linkedEventLocationDescription ?? undefined,
    };
  }

  private toContractCacicElectionSlate(
    slate: CacicElectionSlateRecord,
    options: { includePrivateIdentifiers: true },
  ): AdminCacicElectionSlate;
  private toContractCacicElectionSlate(
    slate: CacicElectionSlateRecord,
    options: { includePrivateIdentifiers: false },
  ): CacicElectionSlate;
  private toContractCacicElectionSlate(
    slate: CacicElectionSlateRecord,
    options: CacicElectionSlateListOptions,
  ): AdminCacicElectionSlate | CacicElectionSlate {
    const submittedBy = slate.submittedBy
      ? {
          userId: slate.submittedBy.id,
          ...(slate.submittedBy.name ? { name: slate.submittedBy.name } : {}),
          ...(slate.submittedBy.preferredUsername ? { preferredUsername: slate.submittedBy.preferredUsername } : {}),
          ...(slate.submittedBy.email ? { email: slate.submittedBy.email } : {}),
        }
      : undefined;
    const members = slate.members.map((member) => {
      const baseMember: CacicElectionSlateMember = {
        id: member.id,
        fullName: member.fullName,
        ...(member.enrollmentNumber ? { enrollmentYear: this.deriveEnrollmentYear(member.enrollmentNumber) } : {}),
        role: this.toContractCacicElectionSlateMemberRole(member.role),
        ...(member.customRole ? { customRole: member.customRole } : {}),
        isRepresentative: member.isRepresentative,
      };

      if (!options.includePrivateIdentifiers) {
        return baseMember;
      }

      return {
        ...baseMember,
        ...(member.enrollmentNumber ? { enrollmentNumber: member.enrollmentNumber } : {}),
        identifierType: this.toContractCacicElectionSlateMemberIdentifierType(member.identifierType),
        identifierValue: member.identifierValue,
      };
    });

    return {
      id: slate.id,
      pollId: slate.pollId,
      name: slate.name,
      status: this.toContractCacicElectionSlateStatus(slate.status),
      enabled: slate.enabled,
      ...(slate.rejectionReason ? { rejectionReason: slate.rejectionReason } : {}),
      submissionSource: this.toContractCacicElectionSlateSubmissionSource(slate.submissionSource),
      ...(submittedBy ? { submittedBy } : {}),
      submittedAt: slate.submittedAt.toISOString(),
      reviewedAt: slate.reviewedAt?.toISOString(),
      members,
    } as AdminCacicElectionSlate | CacicElectionSlate;
  }

  private deriveEnrollmentYear(enrollmentNumber: string): string | undefined {
    const digits = this.onlyDigits(enrollmentNumber);
    return digits.length >= 2 ? digits.slice(0, 2) : undefined;
  }

  private toDbStatus(status: PollStatus): DbPollStatus {
    switch (status) {
      case 'draft':
        return DbPollStatus.DRAFT;
      case 'published':
        return DbPollStatus.PUBLISHED;
      case 'closed':
        return DbPollStatus.CLOSED;
    }
  }

  private toContractStatus(status: DbPollStatus): PollStatus {
    switch (status) {
      case DbPollStatus.DRAFT:
        return 'draft';
      case DbPollStatus.PUBLISHED:
        return 'published';
      case DbPollStatus.CLOSED:
        return 'closed';
    }
  }

  private toDbPollMode(mode: Poll['mode']): DbPollMode {
    switch (mode) {
      case 'regular':
        return DbPollMode.REGULAR;
      case 'cacicElection':
        return DbPollMode.CACIC_ELECTION;
    }
  }

  private toContractPollMode(mode: DbPollMode): Poll['mode'] {
    switch (mode) {
      case DbPollMode.REGULAR:
        return 'regular';
      case DbPollMode.CACIC_ELECTION:
        return 'cacicElection';
    }
  }

  private toDbCacicElectionPhase(phase: CacicElectionPhase): DbCacicElectionPhase {
    switch (phase) {
      case 'slateSubmission':
        return DbCacicElectionPhase.SLATE_SUBMISSION;
      case 'election':
        return DbCacicElectionPhase.ELECTION;
    }
  }

  private toContractCacicElectionPhase(phase: DbCacicElectionPhase | null): CacicElectionPhase | undefined {
    switch (phase) {
      case DbCacicElectionPhase.SLATE_SUBMISSION:
        return 'slateSubmission';
      case DbCacicElectionPhase.ELECTION:
        return 'election';
      case null:
        return undefined;
    }
  }

  private toDbCacicElectionSlateStatus(status: CacicElectionSlateStatus): DbCacicElectionSlateStatus {
    switch (status) {
      case 'pending':
        return DbCacicElectionSlateStatus.PENDING;
      case 'approved':
        return DbCacicElectionSlateStatus.APPROVED;
      case 'rejected':
        return DbCacicElectionSlateStatus.REJECTED;
    }
  }

  private toContractCacicElectionSlateStatus(status: DbCacicElectionSlateStatus): CacicElectionSlateStatus {
    switch (status) {
      case DbCacicElectionSlateStatus.PENDING:
        return 'pending';
      case DbCacicElectionSlateStatus.APPROVED:
        return 'approved';
      case DbCacicElectionSlateStatus.REJECTED:
        return 'rejected';
    }
  }

  private toContractCacicElectionSlateSubmissionSource(
    source: DbCacicElectionSlateSubmissionSource,
  ): CacicElectionSlate['submissionSource'] {
    switch (source) {
      case DbCacicElectionSlateSubmissionSource.PUBLIC:
        return 'public';
      case DbCacicElectionSlateSubmissionSource.ADMIN:
        return 'admin';
    }
  }

  private toDbCacicElectionSlateMemberRole(role: CacicElectionSlateMemberRole): DbCacicElectionSlateMemberRole {
    switch (role) {
      case 'president':
        return DbCacicElectionSlateMemberRole.PRESIDENT;
      case 'vicePresident':
        return DbCacicElectionSlateMemberRole.VICE_PRESIDENT;
      case 'financialDirector':
        return DbCacicElectionSlateMemberRole.FINANCIAL_DIRECTOR;
      case 'communicationDirector':
        return DbCacicElectionSlateMemberRole.COMMUNICATION_DIRECTOR;
      case 'eventsDirector':
        return DbCacicElectionSlateMemberRole.EVENTS_DIRECTOR;
      case 'publicRelationsDirector':
        return DbCacicElectionSlateMemberRole.PUBLIC_RELATIONS_DIRECTOR;
      case 'other':
        return DbCacicElectionSlateMemberRole.OTHER;
    }
  }

  private toContractCacicElectionSlateMemberRole(
    role: DbCacicElectionSlateMemberRole,
  ): CacicElectionSlateMemberRole {
    switch (role) {
      case DbCacicElectionSlateMemberRole.PRESIDENT:
        return 'president';
      case DbCacicElectionSlateMemberRole.VICE_PRESIDENT:
        return 'vicePresident';
      case DbCacicElectionSlateMemberRole.FINANCIAL_DIRECTOR:
        return 'financialDirector';
      case DbCacicElectionSlateMemberRole.COMMUNICATION_DIRECTOR:
        return 'communicationDirector';
      case DbCacicElectionSlateMemberRole.EVENTS_DIRECTOR:
        return 'eventsDirector';
      case DbCacicElectionSlateMemberRole.PUBLIC_RELATIONS_DIRECTOR:
        return 'publicRelationsDirector';
      case DbCacicElectionSlateMemberRole.OTHER:
        return 'other';
    }
  }

  private toDbCacicElectionSlateMemberIdentifierType(
    type: CacicElectionSlateMemberIdentifierType,
  ): DbCacicElectionSlateMemberIdentifierType {
    switch (type) {
      case 'cpf':
        return DbCacicElectionSlateMemberIdentifierType.CPF;
      case 'phone':
        return DbCacicElectionSlateMemberIdentifierType.PHONE;
      case 'email':
        return DbCacicElectionSlateMemberIdentifierType.EMAIL;
    }
  }

  private toContractCacicElectionSlateMemberIdentifierType(
    type: DbCacicElectionSlateMemberIdentifierType,
  ): CacicElectionSlateMemberIdentifierType {
    switch (type) {
      case DbCacicElectionSlateMemberIdentifierType.CPF:
        return 'cpf';
      case DbCacicElectionSlateMemberIdentifierType.PHONE:
        return 'phone';
      case DbCacicElectionSlateMemberIdentifierType.EMAIL:
        return 'email';
    }
  }

  private toDbVotingStyle(style: PollVotingStyle): DbPollVotingStyle {
    switch (style) {
      case 'public':
        return DbPollVotingStyle.PUBLIC;
      case 'partiallySecret':
        return DbPollVotingStyle.PARTIALLY_SECRET;
      case 'secret':
        return DbPollVotingStyle.SECRET;
      case 'anonymous':
        return DbPollVotingStyle.ANONYMOUS;
    }
  }

  private toContractVotingStyle(style: DbPollVotingStyle): PollVotingStyle {
    switch (style) {
      case DbPollVotingStyle.PUBLIC:
        return 'public';
      case DbPollVotingStyle.PARTIALLY_SECRET:
        return 'partiallySecret';
      case DbPollVotingStyle.SECRET:
        return 'secret';
      case DbPollVotingStyle.ANONYMOUS:
        return 'anonymous';
    }
  }

  private toDbVoterEligibilitySource(source: PollVoterEligibilitySource): DbPollVoterEligibilitySource {
    switch (source) {
      case 'authenticatedUsers':
        return DbPollVoterEligibilitySource.AUTHENTICATED_USERS;
      case 'unespUsers':
        return DbPollVoterEligibilitySource.UNESP_USERS;
      case 'computerScienceStudents':
        return DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS;
      case 'eventAttendance':
        return DbPollVoterEligibilitySource.EVENT_ATTENDANCE;
      case 'eventAttendanceUnespUsers':
        return DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS;
      case 'eventAttendanceComputerScienceStudents':
        return DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS;
      case 'enrollmentList':
        return DbPollVoterEligibilitySource.ENROLLMENT_LIST;
    }
  }

  private toContractVoterEligibilitySource(source: DbPollVoterEligibilitySource): PollVoterEligibilitySource {
    switch (source) {
      case DbPollVoterEligibilitySource.AUTHENTICATED_USERS:
        return 'authenticatedUsers';
      case DbPollVoterEligibilitySource.UNESP_USERS:
        return 'unespUsers';
      case DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS:
        return 'computerScienceStudents';
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE:
        return 'eventAttendance';
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS:
        return 'eventAttendanceUnespUsers';
      case DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS:
        return 'eventAttendanceComputerScienceStudents';
      case DbPollVoterEligibilitySource.ENROLLMENT_LIST:
        return 'enrollmentList';
    }
  }

  private isEventAttendanceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
    return (
      source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE ||
      source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS ||
      source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS
    );
  }

  private isComputerScienceEligibilitySource(source: DbPollVoterEligibilitySource): boolean {
    return (
      source === DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS ||
      source === DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS
    );
  }

  private isOptionChoiceElement(type: PollElementType): boolean {
    return type === 'singleChoice' || type === 'multipleChoice' || type === 'selectionDropdown';
  }

  private isGridElement(type: PollElementType): boolean {
    return type === 'singleSelectionGrid' || type === 'multipleSelectionGrid';
  }

  private toDbElementType(type: PollElementType): DbPollElementType {
    switch (type) {
      case 'section':
        return DbPollElementType.SECTION;
      case 'statement':
        return DbPollElementType.STATEMENT;
      case 'shortText':
        return DbPollElementType.SHORT_TEXT;
      case 'longText':
        return DbPollElementType.LONG_TEXT;
      case 'singleChoice':
        return DbPollElementType.SINGLE_CHOICE;
      case 'multipleChoice':
        return DbPollElementType.MULTIPLE_CHOICE;
      case 'singleSelectionGrid':
        return DbPollElementType.SINGLE_SELECTION_GRID;
      case 'multipleSelectionGrid':
        return DbPollElementType.MULTIPLE_SELECTION_GRID;
      case 'selectionDropdown':
        return DbPollElementType.SELECTION_DROPDOWN;
      case 'linearScale':
        return DbPollElementType.LINEAR_SCALE;
      case 'starRating':
        return DbPollElementType.STAR_RATING;
      case 'date':
        return DbPollElementType.DATE;
      case 'time':
        return DbPollElementType.TIME;
      case 'scheduling':
        return DbPollElementType.SCHEDULING;
    }
  }

  private toContractElementType(type: DbPollElementType): PollElementType {
    switch (type) {
      case DbPollElementType.SECTION:
        return 'section';
      case DbPollElementType.STATEMENT:
        return 'statement';
      case DbPollElementType.SHORT_TEXT:
        return 'shortText';
      case DbPollElementType.LONG_TEXT:
        return 'longText';
      case DbPollElementType.SINGLE_CHOICE:
        return 'singleChoice';
      case DbPollElementType.MULTIPLE_CHOICE:
        return 'multipleChoice';
      case DbPollElementType.SINGLE_SELECTION_GRID:
        return 'singleSelectionGrid';
      case DbPollElementType.MULTIPLE_SELECTION_GRID:
        return 'multipleSelectionGrid';
      case DbPollElementType.SELECTION_DROPDOWN:
        return 'selectionDropdown';
      case DbPollElementType.LINEAR_SCALE:
        return 'linearScale';
      case DbPollElementType.STAR_RATING:
        return 'starRating';
      case DbPollElementType.DATE:
        return 'date';
      case DbPollElementType.TIME:
        return 'time';
      case DbPollElementType.SCHEDULING:
        return 'scheduling';
    }
  }

  private cleanOptionalText(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private parseEventDate(value: string, fieldName: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Linked event ${fieldName} is invalid.`);
    }

    return date;
  }
}
