import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PollElementType as DbPollElementType,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
} from '@prisma/client';
import { firstValueFrom, take } from 'rxjs';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavePollDto } from './dto/poll.dto';
import { PollsService } from './polls.service';

type PrismaMock = {
  $transaction: jest.Mock<Promise<unknown>, [(tx: PrismaMock) => Promise<unknown>]>;
  poll: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown?]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    create: jest.Mock<Promise<{ id: string }>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [unknown]>;
  };
  pollElement: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    delete: jest.Mock<Promise<unknown>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  pollElementOption: {
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    createMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  pollImage: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  pollEligibilityEnrollment: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    createMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  pollResponse: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
  };
  pollVoter: {
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
  pollAnswer: {
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
};

type EventManagerMock = jest.Mocked<
  Pick<EventManagerIntegrationService, 'listLinkableEvents' | 'hasAttendance' | 'lookupPeopleByEnrollmentNumbers'>
>;

type FeatureFlagMock = {
  isUndergraduateUnespRoleVerificationDisabled: jest.Mock<Promise<boolean>, []>;
};

type PollsInternals = {
  validatePollInput(input: SavePollDto): void;
  normalizeElementSettings(element: SavePollDto['elements'][number]): unknown;
  resolvePollMetadata(input: SavePollDto, existing?: unknown): Promise<unknown>;
  resolvePollResultVisibility(input: SavePollDto, existing?: unknown): unknown;
  resolvePollResponseOptions(input: SavePollDto, existing: unknown, votingStyle: DbPollVotingStyle): unknown;
  parseEligibilityImport(input: { format: 'csv' | 'txt'; content: string; selectedHeader?: string }): unknown;
  normalizeEnrollmentNumbers(rawValues: readonly unknown[]): unknown;
  toPollResultsVoter(user: {
    id: string;
    name: string | null;
    preferredUsername: string | null;
    email: string | null;
    claims: unknown;
  }): unknown;
  ensureVotingAllowed(poll: unknown, user: AuthenticatedPrincipal): Promise<void>;
  validateResponse(poll: unknown, input: { answers: { elementId: string; value: unknown }[] }): unknown;
  normalizeAnswer(element: unknown, rawValue: unknown): unknown;
  ensureRequiredGridRows(
    element: { required: boolean; title: string },
    rows: readonly { id: string; label: string }[],
    selected: Record<string, string | string[]>,
  ): void;
  isEmptyAnswer(value: unknown): boolean;
  buildSchedulingSlots(settings: {
    durationMinutes: number;
    slotIntervalMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    availability: { id: string; date: string; startTime: string; endTime: string }[];
  }): { id: string }[];
  subscribeToPollResults(
    pollId: string,
    listener: (event: { admin: unknown; public: unknown }) => void,
  ): () => void;
  publishPollResults(event: { admin: { pollId: string; responseCount?: number; responses?: unknown[] }; public: unknown }): void;
  resultSubscribers: Map<string, Set<unknown>>;
  toContractPoll(poll: unknown): unknown;
  toDbStatus(status: string): DbPollStatus;
  toDbVotingStyle(style: string): DbPollVotingStyle;
  toDbVoterEligibilitySource(source: string): DbPollVoterEligibilitySource;
  toDbElementType(type: string): DbPollElementType;
  toContractStatus(status: DbPollStatus): string;
  toContractVotingStyle(status: DbPollVotingStyle): string;
  toContractVoterEligibilitySource(source: DbPollVoterEligibilitySource): string;
  toContractElementType(type: DbPollElementType): string;
  cleanOptionalText(value?: string): string | undefined;
  parseEventDate(value: string, fieldName: string): Date;
  parseStringList(value: string): string[];
};

function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    $transaction: jest.fn(async (callback) => callback(prisma)),
    poll: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    pollElement: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    pollElementOption: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pollImage: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pollEligibilityEnrollment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pollResponse: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    pollVoter: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    pollAnswer: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  return prisma;
}

function createEventManagerMock(): EventManagerMock {
  return {
    listLinkableEvents: jest.fn().mockResolvedValue([
      {
        id: 'event-1',
        name: 'CACiC',
        startDate: '2026-06-21T10:00:00.000Z',
        endDate: '2026-06-21T12:00:00.000Z',
        locationDescription: 'Sala 1',
        shouldCollectAttendance: true,
      },
    ]),
    hasAttendance: jest.fn().mockResolvedValue(true),
    lookupPeopleByEnrollmentNumbers: jest.fn().mockResolvedValue([]),
  };
}

function createUser(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    sub: 'user-1',
    preferredUsername: 'ada',
    email: 'ada@unesp.br',
    roles: [],
    permissions: [],
    scopes: [],
    oidcScopes: [],
    claims: {
      enrollmentNumber: '24123456',
      unesp_role: 'aluno-graduacao',
      unespRoleVerified: true,
    },
    token: 'token',
    roleSet: new Set(),
    permissionSet: new Set(),
    ...overrides,
  };
}

const createdAt = new Date('2026-06-20T10:00:00.000Z');
const updatedAt = new Date('2026-06-21T10:00:00.000Z');
const publishedAt = new Date('2026-06-21T11:00:00.000Z');

function option(id: string, label = id) {
  return {
    id,
    label,
    description: undefined,
    position: 0,
  };
}

function dbElement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'question-1',
    type: DbPollElementType.SHORT_TEXT,
    title: 'Question',
    description: null,
    required: false,
    settings: null,
    position: 0,
    retiredAt: null,
    options: [],
    ...overrides,
  };
}

function pollRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poll-1',
    title: 'Poll',
    description: null,
    status: DbPollStatus.PUBLISHED,
    votingStyle: DbPollVotingStyle.SECRET,
    voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    directLinkToken: null,
    resultsPublic: true,
    resultsLive: true,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    linkedEventId: null,
    linkedEventName: null,
    linkedEventStartDate: null,
    linkedEventEndDate: null,
    linkedEventLocationDescription: null,
    createdAt,
    updatedAt,
    publishedAt,
    elements: [dbElement()],
    _count: { elements: 1, responses: 2 },
    ...overrides,
  };
}

function responseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response-1',
    pollId: 'poll-1',
    userId: 'user-1',
    submittedAt: new Date('2026-06-21T12:00:00.000Z'),
    createdAt: new Date('2026-06-21T12:00:00.000Z'),
    answers: [{ elementId: 'question-1', value: 'answer', elementSnapshot: null, element: dbElement() }],
    user: {
      id: 'user-1',
      name: null,
      preferredUsername: null,
      email: null,
      claims: {
        name: 'Ada Lovelace',
        preferred_username: 'ada',
        email: 'ada@unesp.br',
        enrollment_number: '24123456',
        attributes: {
          unesp_role: ['aluno-graduacao', 'aluno-graduacao'],
        },
      },
    },
    ...overrides,
  };
}

function savePoll(overrides: Partial<SavePollDto> = {}): SavePollDto {
  return {
    title: ' Poll ',
    description: ' Description ',
    status: 'draft',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    elements: [
      {
        id: 'question-1',
        type: 'shortText',
        title: ' Question ',
        description: ' Help ',
        required: true,
        options: [],
      },
    ],
    ...overrides,
  };
}

function schedulingSettings(overrides: Record<string, unknown> = {}): never {
  return {
    hostName: ' Host ',
    location: ' Room ',
    timezone: ' America/Sao_Paulo ',
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 5,
    inviteeMode: 'optional',
    maxInvitees: 2,
    availability: [
      {
        id: 'window-1',
        date: '2026-06-24',
        startTime: '09:00',
        endTime: '11:00',
      },
    ],
    ...overrides,
  } as never;
}

describe('PollsService', () => {
  let prisma: PrismaMock;
  let eventManager: EventManagerMock;
  let featureFlags: FeatureFlagMock;
  let service: PollsService;
  let internals: PollsInternals;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
    prisma = createPrismaMock();
    eventManager = createEventManagerMock();
    featureFlags = {
      isUndergraduateUnespRoleVerificationDisabled: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
    };
    service = new PollsService(
      prisma as unknown as PrismaService,
      eventManager as unknown as EventManagerIntegrationService,
      undefined,
      featureFlags as unknown as FeatureFlagService,
    );
    internals = service as unknown as PollsInternals;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delegates linkable events to Event Manager', async () => {
    await expect(service.listLinkableEvents()).resolves.toEqual([
      expect.objectContaining({ id: 'event-1', name: 'CACiC' }),
    ]);
  });

  it('lists admin and public polls with summary metadata', async () => {
    const linkedPoll = pollRecord({
      status: DbPollStatus.CLOSED,
      votingStyle: DbPollVotingStyle.PUBLIC,
      voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE,
      linkedEventId: 'event-1',
      linkedEventName: 'CACiC',
      linkedEventStartDate: new Date('2026-06-21T10:00:00.000Z'),
      linkedEventEndDate: new Date('2026-06-21T12:00:00.000Z'),
      linkedEventLocationDescription: 'Sala 1',
    });
    prisma.poll.findMany.mockResolvedValue([linkedPoll]);

    await expect(service.listAdminPolls()).resolves.toEqual([
      expect.objectContaining({
        id: 'poll-1',
        status: 'closed',
        votingStyle: 'public',
        voterEligibilitySource: 'eventAttendance',
        linkedEvent: {
          id: 'event-1',
          name: 'CACiC',
          startDate: '2026-06-21T10:00:00.000Z',
          endDate: '2026-06-21T12:00:00.000Z',
          locationDescription: 'Sala 1',
        },
        elementCount: 1,
        responseCount: 2,
      }),
    ]);
    await expect(service.listPublicPolls()).resolves.toHaveLength(1);
    expect(prisma.poll.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.poll.findMany.mock.calls[1][0]).toMatchObject({
      where: {
        OR: [{ status: DbPollStatus.PUBLISHED }, { status: DbPollStatus.CLOSED, resultsPublic: true }],
      },
    });
  });

  it('maps summary optional descriptions and publication dates', async () => {
    prisma.poll.findMany
      .mockResolvedValueOnce([pollRecord({ description: 'Description', publishedAt: null })])
      .mockResolvedValueOnce([pollRecord({ description: 'Public description', publishedAt: null })]);

    await expect(service.listAdminPolls()).resolves.toEqual([
      expect.objectContaining({
        description: 'Description',
        publishedAt: undefined,
      }),
    ]);
    await expect(service.listPublicPolls()).resolves.toEqual([
      expect.objectContaining({
        description: 'Public description',
        publishedAt: undefined,
      }),
    ]);
  });

  it('reads admin and published polls or rejects missing polls', async () => {
    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord());
    await expect(service.getAdminPoll('poll-1')).resolves.toMatchObject({ id: 'poll-1', elements: expect.any(Array) });

    prisma.poll.findUnique.mockResolvedValueOnce(null);
    await expect(service.getAdminPoll('missing')).rejects.toBeInstanceOf(NotFoundException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.CLOSED, resultsPublic: true }));
    await expect(service.getPublishedPoll('poll-1', createUser())).resolves.toMatchObject({ status: 'closed' });

    prisma.poll.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPublishedPoll('missing', createUser())).rejects.toBeInstanceOf(NotFoundException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }));
    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPublishedPoll('poll-1', createUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns admin and public poll results with audience-specific voter metadata', async () => {
    prisma.poll.findUnique.mockResolvedValue({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.ANONYMOUS,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: true,
    });
    prisma.pollResponse.findMany.mockResolvedValue([responseRecord()]);

    await expect(service.getAdminPollResults('poll-1')).resolves.toEqual({
      pollId: 'poll-1',
      anonymous: true,
      responseCount: 1,
      responses: [
        {
          id: 'response-1',
          submittedAt: '2026-06-21T12:00:00.000Z',
          voter: {
            userId: 'user-1',
            name: 'Ada Lovelace',
            preferredUsername: 'ada',
            email: 'ada@unesp.br',
            unespRole: 'aluno-graduacao',
            enrollmentNumber: '24123456',
          },
          answers: [
            {
              elementId: 'question-1',
              value: 'answer',
              element: expect.objectContaining({ id: 'question-1', title: 'Question' }),
            },
          ],
        },
      ],
    });

    await expect(service.getPublicPollResults('poll-1', createUser())).resolves.toEqual({
      pollId: 'poll-1',
      anonymous: true,
      responseCount: 1,
      responses: [
        {
          id: 'response-1',
          submittedAt: undefined,
          voter: undefined,
          answers: [
            {
              elementId: 'question-1',
              value: 'answer',
              element: expect.objectContaining({ id: 'question-1', title: 'Question' }),
            },
          ],
        },
      ],
    });
  });

  it('omits admin result submission timestamps when responses are not submitted', async () => {
    prisma.poll.findUnique.mockResolvedValue({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: true,
    });
    prisma.pollResponse.findMany.mockResolvedValue([responseRecord({ submittedAt: null })]);

    await expect(service.getAdminPollResults('poll-1')).resolves.toEqual(
      expect.objectContaining({
        responses: [
          expect.objectContaining({
            submittedAt: undefined,
          }),
        ],
      }),
    );
  });

  it('enforces public result visibility rules', async () => {
    prisma.poll.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPublicPollResults('missing')).rejects.toBeInstanceOf(NotFoundException);

    prisma.poll.findUnique.mockResolvedValueOnce({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: false,
      resultsLive: true,
    });
    await expect(service.getPublicPollResults('poll-1', createUser())).rejects.toBeInstanceOf(ForbiddenException);

    prisma.poll.findUnique.mockResolvedValueOnce({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: false,
    });
    await expect(service.getPublicPollResults('poll-1', createUser())).rejects.toBeInstanceOf(ForbiddenException);

    prisma.poll.findUnique.mockResolvedValueOnce({
      id: 'poll-1',
      status: DbPollStatus.CLOSED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: false,
    });
    prisma.pollResponse.findMany.mockResolvedValueOnce([]);
    await expect(service.getPublicPollResults('poll-1', createUser())).resolves.toMatchObject({ responseCount: 0 });

    prisma.poll.findUnique.mockResolvedValueOnce({
      id: 'poll-1',
      status: DbPollStatus.CLOSED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: false,
    });
    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPublicPollResults('poll-1', createUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('streams catch-up result deltas and published updates', async () => {
    prisma.poll.findUnique.mockResolvedValue({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      resultsPublic: true,
      resultsLive: true,
    });
    prisma.pollResponse.count.mockResolvedValue(2);
    prisma.pollResponse.findMany.mockResolvedValue([responseRecord({ id: 'response-2' })]);

    const firstEvent = await firstValueFrom(service.streamAdminPollResults('poll-1', -5).pipe(take(1)));
    expect(firstEvent.data).toMatchObject({
      pollId: 'poll-1',
      responseCount: 2,
      responses: [expect.objectContaining({ id: 'response-2' })],
    });
    expect(prisma.pollResponse.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));

    prisma.pollResponse.findMany.mockResolvedValue([]);
    await expect(firstValueFrom(service.streamPublicPollResults('poll-1', 0, createUser()).pipe(take(1)))).resolves.toMatchObject({
      data: { pollId: 'poll-1', responseCount: 2 },
    });

    prisma.poll.findUnique.mockRejectedValueOnce(new Error('boom'));
    await expect(firstValueFrom(service.streamAdminPollResults('poll-1', 0))).rejects.toThrow('boom');
  });

  it('creates polls with normalized metadata, elements, and linked events', async () => {
    prisma.poll.create.mockResolvedValue({ id: 'poll-1' });
    prisma.poll.findUniqueOrThrow.mockResolvedValue(
      pollRecord({
        status: DbPollStatus.PUBLISHED,
        linkedEventId: 'event-1',
        linkedEventName: 'CACiC',
        linkedEventStartDate: new Date('2026-06-21T10:00:00.000Z'),
        linkedEventEndDate: new Date('2026-06-21T12:00:00.000Z'),
        linkedEventLocationDescription: 'Sala 1',
      }),
    );

    await expect(
      service.createPoll(
        savePoll({
          status: 'published',
          linkedEventId: ' event-1 ',
          voterEligibilitySource: 'eventAttendance',
          resultsPublic: true,
          resultsLive: true,
          allowResponseEditing: true,
        }),
        createUser(),
      ),
    ).resolves.toMatchObject({ status: 'published', linkedEvent: expect.objectContaining({ id: 'event-1' }) });

    expect(prisma.poll.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Poll',
        description: 'Description',
        status: DbPollStatus.PUBLISHED,
        linkedEventId: 'event-1',
        linkedEventName: 'CACiC',
        resultsPublic: true,
        resultsLive: true,
        allowResponseEditing: true,
        publishedAt: new Date('2026-06-21T12:00:00.000Z'),
      }),
    });
    expect(prisma.pollElement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pollId: 'poll-1' } }));
    expect(prisma.pollElement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Question',
        description: 'Help',
        position: 0,
      }),
    });
  });

  it('creates draft and closed polls with default status and element settings', async () => {
    prisma.poll.create.mockResolvedValue({ id: 'poll-1' });
    prisma.poll.findUniqueOrThrow
      .mockResolvedValueOnce(pollRecord({ status: DbPollStatus.DRAFT, publishedAt: null }))
      .mockResolvedValueOnce(
        pollRecord({
          status: DbPollStatus.CLOSED,
          elements: [dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: { linearScale: { min: 1, max: 5 } } })],
        }),
      );

    const draftInput = savePoll();
    delete draftInput.status;
    delete draftInput.votingStyle;
    delete draftInput.voterEligibilitySource;
    delete draftInput.resultsPublic;
    delete draftInput.resultsLive;
    delete draftInput.allowResponseEditing;
    delete draftInput.allowMultipleResponses;

    await expect(service.createPoll(draftInput, createUser())).resolves.toMatchObject({ status: 'draft' });
    expect(prisma.poll.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        status: DbPollStatus.DRAFT,
        votingStyle: DbPollVotingStyle.SECRET,
        voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
        publishedAt: undefined,
        closedAt: undefined,
      }),
    });

    await expect(
      service.createPoll(
        savePoll({
          status: 'closed',
          elements: [
            {
              id: 'scale',
              type: 'linearScale',
              title: 'Scale',
              required: false,
              options: [],
              settings: { linearScale: { min: 1, max: 5, maxLabel: ' High ' } },
            },
          ],
        }),
        createUser(),
      ),
    ).resolves.toMatchObject({ status: 'closed' });
    expect(prisma.poll.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        status: DbPollStatus.CLOSED,
        closedAt: new Date('2026-06-21T12:00:00.000Z'),
      }),
    });
    expect(prisma.pollElement.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        settings: { linearScale: { min: 1, max: 5, maxLabel: 'High' } },
      }),
    });
  });

  it('updates polls, preserves existing linked event metadata, and toggles publication dates', async () => {
    const existing = pollRecord({
      status: DbPollStatus.DRAFT,
      linkedEventId: 'event-1',
      linkedEventName: 'Existing Event',
      linkedEventStartDate: new Date('2026-06-20T10:00:00.000Z'),
      linkedEventEndDate: new Date('2026-06-20T12:00:00.000Z'),
      linkedEventLocationDescription: null,
      publishedAt: null,
    });
    prisma.poll.findUnique.mockResolvedValueOnce(existing);
    prisma.poll.findUniqueOrThrow.mockResolvedValue(pollRecord({ status: DbPollStatus.PUBLISHED }));

    await expect(
      service.updatePoll(
        'poll-1',
        savePoll({ status: 'published', linkedEventId: 'event-1', voterEligibilitySource: 'eventAttendance' }),
        createUser(),
      ),
    ).resolves.toMatchObject({ status: 'published' });

    expect(eventManager.listLinkableEvents).not.toHaveBeenCalled();
    expect(prisma.poll.update).toHaveBeenCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.PUBLISHED,
        linkedEventName: 'Existing Event',
        publishedAt: new Date('2026-06-21T12:00:00.000Z'),
        closedAt: null,
      }),
    });

    prisma.poll.findUnique.mockResolvedValueOnce(null);
    await expect(service.updatePoll('missing', savePoll(), createUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('snapshots existing answers and retires removed answered elements when polls are edited', async () => {
    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord());
    prisma.poll.findUniqueOrThrow.mockResolvedValueOnce(pollRecord({ elements: [] }));
    prisma.pollElement.findMany
      .mockResolvedValueOnce([dbElement({ options: [option('yes', 'Sim')] })])
      .mockResolvedValueOnce([
        { ...dbElement({ id: 'question-1' }), _count: { answers: 1 } },
        { ...dbElement({ id: 'draft-only' }), _count: { answers: 0 } },
      ]);

    await service.updatePoll('poll-1', savePoll({ elements: [] }), createUser());

    expect(prisma.pollAnswer.updateMany).toHaveBeenCalledWith({
      where: {
        elementId: 'question-1',
        elementSnapshot: { equals: expect.anything() },
      },
      data: {
        elementSnapshot: expect.objectContaining({
          id: 'question-1',
          title: 'Question',
          options: [{ id: 'yes', label: 'Sim', description: undefined }],
        }),
      },
    });
    expect(prisma.pollElement.update).toHaveBeenCalledWith({
      where: { id: 'question-1' },
      data: { retiredAt: new Date('2026-06-21T12:00:00.000Z') },
    });
    expect(prisma.pollElement.delete).toHaveBeenCalledWith({ where: { id: 'draft-only' } });
  });

  it('updates polls with default status and preserves existing publication or closure dates', async () => {
    const existingPublished = pollRecord({
      status: DbPollStatus.PUBLISHED,
      publishedAt,
      closedAt: null,
    });
    const inputWithoutStatus = savePoll();
    delete inputWithoutStatus.status;
    prisma.poll.findUnique.mockResolvedValueOnce(existingPublished);
    prisma.poll.findUniqueOrThrow.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.PUBLISHED, publishedAt }));

    await service.updatePoll('poll-1', inputWithoutStatus, createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.PUBLISHED,
        publishedAt,
        closedAt: null,
      }),
    });

    const existingClosedAt = new Date('2026-06-20T12:00:00.000Z');
    prisma.poll.findUnique.mockResolvedValueOnce(
      pollRecord({
        status: DbPollStatus.CLOSED,
        closedAt: existingClosedAt,
      }),
    );
    prisma.poll.findUniqueOrThrow.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.CLOSED }));

    await service.updatePoll('poll-1', savePoll({ status: 'closed' }), createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.CLOSED,
        closedAt: existingClosedAt,
      }),
    });

    prisma.poll.findUnique.mockResolvedValueOnce(
      pollRecord({
        status: DbPollStatus.CLOSED,
        closedAt: null,
      }),
    );
    prisma.poll.findUniqueOrThrow.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.CLOSED }));

    await service.updatePoll('poll-1', savePoll({ status: 'closed' }), createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.CLOSED,
        closedAt: new Date('2026-06-21T12:00:00.000Z'),
      }),
    });
  });

  it('updates status and deletes polls', async () => {
    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord({ publishedAt: null }));
    prisma.poll.update.mockResolvedValue(pollRecord({ status: DbPollStatus.CLOSED }));

    await expect(service.updatePollStatus('poll-1', 'closed', createUser())).resolves.toMatchObject({ status: 'closed' });
    expect(prisma.poll.update).toHaveBeenCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.CLOSED,
        closedAt: new Date('2026-06-21T12:00:00.000Z'),
      }),
      include: expect.any(Object),
    });

    prisma.poll.findUnique.mockResolvedValueOnce(null);
    await expect(service.updatePollStatus('missing', 'draft', createUser())).rejects.toBeInstanceOf(NotFoundException);

    await service.deletePoll('poll-1');
    expect(prisma.poll.deleteMany).toHaveBeenCalledWith({ where: { id: 'poll-1' } });
  });

  it('preserves existing status transition timestamps', async () => {
    const existingClosedAt = new Date('2026-06-20T12:00:00.000Z');

    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord({ publishedAt }));
    prisma.poll.update.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.PUBLISHED, publishedAt }));
    await service.updatePollStatus('poll-1', 'published', createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.PUBLISHED,
        publishedAt,
      }),
      include: expect.any(Object),
    });

    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord({ closedAt: existingClosedAt }));
    prisma.poll.update.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.CLOSED }));
    await service.updatePollStatus('poll-1', 'closed', createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.CLOSED,
        closedAt: existingClosedAt,
      }),
      include: expect.any(Object),
    });

    prisma.poll.findUnique.mockResolvedValueOnce(pollRecord({ publishedAt: null }));
    prisma.poll.update.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.PUBLISHED }));
    await service.updatePollStatus('poll-1', 'published', createUser());
    expect(prisma.poll.update).toHaveBeenLastCalledWith({
      where: { id: 'poll-1' },
      data: expect.objectContaining({
        status: DbPollStatus.PUBLISHED,
        publishedAt: new Date('2026-06-21T12:00:00.000Z'),
      }),
      include: expect.any(Object),
    });
  });

  it('lists, enriches, clears, and deletes eligibility enrollments', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    prisma.pollEligibilityEnrollment.findMany.mockResolvedValue([
      { pollId: 'poll-1', enrollmentNumber: '20240001', createdAt },
    ]);
    eventManager.lookupPeopleByEnrollmentNumbers.mockResolvedValue([
      { enrollmentNumber: '20240001', name: 'Ada', email: 'ada@example.com' },
      { enrollmentNumber: ' ', name: 'Ignored', email: null },
    ]);

    await expect(service.listEligibilityEnrollments('poll-1')).resolves.toEqual({
      totalCount: 1,
      entries: [
        {
          pollId: 'poll-1',
          enrollmentNumber: '20240001',
          createdAt: createdAt.toISOString(),
          people: [{ enrollmentNumber: '20240001', name: 'Ada', email: 'ada@example.com' }],
        },
      ],
    });

    await service.deleteEligibilityEnrollment('poll-1', ' 20240001 ');
    expect(prisma.pollEligibilityEnrollment.deleteMany).toHaveBeenCalledWith({
      where: { pollId: 'poll-1', enrollmentNumber: '20240001' },
    });

    await expect(service.clearEligibilityEnrollments('poll-1')).resolves.toEqual({ entries: [], totalCount: 0 });
  });

  it('groups multiple Event Manager people under the same enrollment', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    prisma.pollEligibilityEnrollment.findMany.mockResolvedValue([
      { pollId: 'poll-1', enrollmentNumber: '20240001', createdAt },
    ]);
    eventManager.lookupPeopleByEnrollmentNumbers.mockResolvedValue([
      { enrollmentNumber: '20240001', name: 'Ada', email: 'ada@example.com' },
      { enrollmentNumber: '20240001', name: 'Grace', email: null },
    ]);

    await expect(service.listEligibilityEnrollments('poll-1')).resolves.toEqual({
      totalCount: 1,
      entries: [
        expect.objectContaining({
          people: [
            { enrollmentNumber: '20240001', name: 'Ada', email: 'ada@example.com' },
            { enrollmentNumber: '20240001', name: 'Grace', email: null },
          ],
        }),
      ],
    });
  });

  it('handles eligibility enrollment import modes, duplicates, invalid values, and enrichment failures', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    prisma.pollEligibilityEnrollment.createMany.mockResolvedValue({ count: 1 });
    prisma.pollEligibilityEnrollment.deleteMany.mockResolvedValue({ count: 3 });
    prisma.pollEligibilityEnrollment.findMany.mockResolvedValue([
      { pollId: 'poll-1', enrollmentNumber: '20240001', createdAt },
    ]);
    eventManager.lookupPeopleByEnrollmentNumbers.mockRejectedValue(new Error('down'));

    await expect(
      service.addEligibilityEnrollments(
        'poll-1',
        { enrollmentNumbers: [' 20240001 ', '20240001', ''.padEnd(65, '1'), 123 as unknown as string] },
        createUser(),
      ),
    ).resolves.toMatchObject({
      createdCount: 1,
      duplicateCount: 1,
      invalidCount: 1,
      existingCount: 1,
      replacedCount: 0,
    });

    await expect(
      service.importEligibilityEnrollments(
        'poll-1',
        {
          format: 'csv',
          content: '\uFEFFmatricula;nome\n"20240002";"Ada; Lovelace"',
          selectedHeader: 'matricula',
          mode: 'replace',
        },
        createUser(),
      ),
    ).resolves.toMatchObject({
      createdCount: 1,
      duplicateCount: 0,
      invalidCount: 0,
      existingCount: 0,
      replacedCount: 3,
    });

    await expect(
      service.importEligibilityEnrollments('poll-1', { format: 'txt', content: '20240003\n20240003' }, createUser()),
    ).resolves.toMatchObject({ duplicateCount: 1 });
  });

  it('rejects invalid eligibility operations', async () => {
    prisma.poll.findUnique.mockResolvedValueOnce(null);
    await expect(service.listEligibilityEnrollments('missing')).rejects.toBeInstanceOf(NotFoundException);

    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    await expect(service.deleteEligibilityEnrollment('poll-1', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.addEligibilityEnrollments('poll-1', { enrollmentNumbers: [' '] }, createUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.importEligibilityEnrollments('poll-1', { format: 'csv', content: 'a\n1' }, createUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submits new, multiple, editable, and anonymous responses', async () => {
    const baseResponse = responseRecord();
    prisma.poll.findFirst.mockResolvedValue(pollRecord());
    prisma.pollVoter.findUnique.mockResolvedValue(null);
    prisma.pollResponse.create.mockResolvedValue(baseResponse);
    prisma.pollResponse.count.mockResolvedValue(1);

    await expect(
      service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: ' answer ' }] }, createUser()),
    ).resolves.toEqual({
      id: 'response-1',
      pollId: 'poll-1',
      submittedAt: '2026-06-21T12:00:00.000Z',
      answers: [
        {
          elementId: 'question-1',
          value: 'answer',
          element: expect.objectContaining({ id: 'question-1', title: 'Question' }),
        },
      ],
    });
    expect(prisma.pollVoter.create).toHaveBeenCalledWith({ data: { pollId: 'poll-1', userId: 'user-1' } });
    expect(prisma.pollResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        answers: {
          create: [
            expect.objectContaining({
              elementId: 'question-1',
              elementSnapshot: expect.objectContaining({ id: 'question-1', title: 'Question' }),
              value: 'answer',
            }),
          ],
        },
      }),
      include: expect.any(Object),
    });

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ allowMultipleResponses: true }));
    await service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser());
    expect(prisma.pollVoter.upsert).toHaveBeenCalled();

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ allowResponseEditing: true }));
    prisma.pollVoter.findUnique.mockResolvedValueOnce({ userId: 'user-1' });
    prisma.pollResponse.findFirst.mockResolvedValueOnce({ id: 'response-1' });
    prisma.pollResponse.update.mockResolvedValueOnce(baseResponse);
    await service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'updated' }] }, createUser());
    expect(prisma.pollAnswer.deleteMany).toHaveBeenCalledWith({ where: { responseId: 'response-1' } });
    expect(prisma.pollResponse.update).toHaveBeenCalled();

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ votingStyle: DbPollVotingStyle.ANONYMOUS }));
    prisma.pollVoter.findUnique.mockResolvedValueOnce(null);
    prisma.pollResponse.create.mockResolvedValueOnce(responseRecord({ userId: null, submittedAt: null, user: null }));
    await service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'secret' }] }, createUser());
    expect(prisma.pollResponse.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        pollId: 'poll-1',
        id: expect.any(String),
        userId: null,
        submittedAt: null,
        answers: { create: [expect.objectContaining({ id: expect.any(String), value: 'secret' })] },
      }),
      include: expect.any(Object),
    });
  });

  it('uses the direct-link token as additional voting eligibility', async () => {
    const token = '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad';
    prisma.poll.findFirst.mockResolvedValueOnce(
      pollRecord({
        voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST,
        directLinkEnabled: true,
        directLinkToken: token,
        images: [
          {
            id: 'image-1',
            pollId: 'poll-1',
            placement: 'POLL_DESCRIPTION',
            elementId: null,
            width: 1200,
            height: 630,
            altText: null,
            caption: null,
            position: 0,
          },
        ],
      }),
    );

    await expect(service.getPublishedPollByDirectLink(token, createUser())).resolves.toMatchObject({
      id: 'poll-1',
      directLinkEnabled: true,
      descriptionImages: [
        expect.objectContaining({
          url: `/api/polls/direct/${token}/images/image-1`,
        }),
      ],
    });
    expect(prisma.pollEligibilityEnrollment.findUnique).not.toHaveBeenCalled();

    prisma.poll.findFirst.mockResolvedValueOnce(
      pollRecord({
        voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST,
        directLinkEnabled: true,
        directLinkToken: token,
      }),
    );
    prisma.pollVoter.findUnique.mockResolvedValueOnce(null);
    prisma.pollResponse.create.mockResolvedValueOnce(responseRecord());

    await expect(
      service.submitDirectLinkResponse(
        token,
        { answers: [{ elementId: 'question-1', value: 'answer' }] },
        createUser(),
      ),
    ).resolves.toMatchObject({ id: 'response-1' });
    expect(prisma.pollVoter.create).toHaveBeenCalledWith({ data: { pollId: 'poll-1', userId: 'user-1' } });
    expect(prisma.pollEligibilityEnrollment.findUnique).not.toHaveBeenCalled();

    await expect(service.getPublishedPollByDirectLink('not-a-token', createUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid response submission states', async () => {
    prisma.poll.findFirst.mockResolvedValueOnce(null);
    await expect(service.submitResponse('missing', { answers: [] }, createUser())).rejects.toBeInstanceOf(NotFoundException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord());
    await expect(service.submitResponse('poll-1', { answers: [] })).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord());
    prisma.pollVoter.findUnique.mockResolvedValueOnce({ userId: 'user-1' });
    await expect(
      service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser()),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ allowResponseEditing: true }));
    prisma.pollVoter.findUnique.mockResolvedValueOnce({ userId: 'user-1' });
    prisma.pollResponse.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser()),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord());
    prisma.pollVoter.findUnique.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns user response state for anonymous, editable, multiple, and closed polls', async () => {
    prisma.poll.findFirst.mockResolvedValueOnce(
      pollRecord({
        votingStyle: DbPollVotingStyle.ANONYMOUS,
        allowMultipleResponses: true,
      }),
    );
    prisma.pollVoter.findUnique.mockResolvedValueOnce({ userId: 'user-1' });

    await expect(service.getUserResponseState('poll-1', createUser())).resolves.toEqual({
      hasSubmitted: true,
      canEdit: false,
      canSubmitAnother: true,
    });

    prisma.poll.findFirst.mockResolvedValueOnce(
      pollRecord({
        allowResponseEditing: true,
      }),
    );
    prisma.pollVoter.findUnique.mockResolvedValueOnce(null);
    prisma.pollResponse.findFirst.mockResolvedValueOnce(responseRecord());
    await expect(service.getUserResponseState('poll-1', createUser())).resolves.toMatchObject({
      hasSubmitted: true,
      canEdit: true,
      canSubmitAnother: false,
      response: expect.objectContaining({ id: 'response-1' }),
    });

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ status: DbPollStatus.CLOSED, allowResponseEditing: true }));
    prisma.pollVoter.findUnique.mockResolvedValueOnce(null);
    prisma.pollResponse.findFirst.mockResolvedValueOnce(responseRecord());
    await expect(service.getUserResponseState('poll-1', createUser())).resolves.toMatchObject({
      canEdit: false,
      canSubmitAnother: false,
    });

    prisma.poll.findFirst.mockResolvedValueOnce(null);
    await expect(service.getUserResponseState('missing', createUser())).rejects.toBeInstanceOf(NotFoundException);
    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord());
    await expect(service.getUserResponseState('poll-1')).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.poll.findFirst.mockResolvedValueOnce(pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }));
    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce(null);
    await expect(service.getUserResponseState('poll-1', createUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces every voter eligibility source', async () => {
    await expect(internals.ensureVotingAllowed(pollRecord(), createUser())).resolves.toBeUndefined();

    await expect(
      internals.ensureVotingAllowed(pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.UNESP_USERS }), createUser()),
    ).resolves.toBeUndefined();
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.UNESP_USERS }),
        createUser({ email: 'ada@example.com', claims: {} }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
          requireVerifiedUnespRole: true,
        }),
        createUser(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS }),
        createUser({ claims: { enrollmentNumber: '24003456', unesp_role: 'aluno-graduacao' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
          requireVerifiedUnespRole: true,
        }),
        createUser({ claims: { enrollmentNumber: '24123456', unesp_role: 'aluno-graduacao' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValueOnce(true);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
          requireVerifiedUnespRole: true,
        }),
        createUser({ claims: { enrollmentNumber: '24123456', unesp_role: 'aluno-graduacao' } }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE, linkedEventId: null }),
        createUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    eventManager.hasAttendance.mockResolvedValueOnce(false);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE, linkedEventId: 'event-1' }),
        createUser(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS,
          linkedEventId: 'event-1',
        }),
        createUser(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS,
          linkedEventId: 'event-1',
        }),
        createUser(),
      ),
    ).resolves.toBeUndefined();

    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce({ enrollmentNumber: '24123456' });
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }),
        createUser(),
      ),
    ).resolves.toBeUndefined();
    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce(null);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }),
        createUser({ claims: { academic_id: '24123456' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }),
        createUser({ claims: {} }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates poll input structure and element settings', () => {
    expect(() => internals.validatePollInput(savePoll({ title: ' ' }))).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [savePoll().elements[0], savePoll().elements[0]] })),
    ).toThrow(BadRequestException);
    expect(() => internals.validatePollInput(savePoll({ elements: [{ ...savePoll().elements[0], title: ' ' }] }))).toThrow(
      BadRequestException,
    );
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [{ ...savePoll().elements[0], type: 'singleChoice', options: [option('a')] }],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...savePoll().elements[0], options: [option('a'), option('b')] }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...savePoll().elements[0],
              type: 'singleChoice',
              options: [option('a'), option('a')],
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...savePoll().elements[0],
              type: 'singleChoice',
              options: [option('a'), { ...option('b'), label: ' ' }],
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('validates grid, scale, rating, and scheduling settings', () => {
    const base = savePoll().elements[0];
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'singleSelectionGrid', settings: {} }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'singleSelectionGrid',
              settings: { grid: { rows: [], columns: [option('a'), option('b')] } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'linearScale',
              settings: { linearScale: { min: 2 as 0, max: 5 } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'linearScale',
              settings: { linearScale: { min: 1, max: 1 } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'starRating', settings: {} }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({ elements: [{ ...base, type: 'starRating', settings: { starRating: { max: 11 } } }] }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'scheduling',
              settings: { linearScale: { min: 1, max: 5 }, scheduling: schedulingSettings() },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'scheduling',
              settings: { scheduling: schedulingSettings({ timezone: ' ' }) },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'scheduling',
              settings: { scheduling: schedulingSettings({ inviteeMode: 'invalid' }) },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'scheduling',
              settings: { scheduling: schedulingSettings({ availability: [] }) },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'scheduling',
              settings: {
                scheduling: schedulingSettings({
                  inviteeMode: 'none',
                  maxInvitees: 0,
                  availability: [
                    { id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '11:00' },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('normalizes element settings', () => {
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'singleSelectionGrid',
        settings: {
          grid: {
            rows: [{ id: ' row ', label: ' Row ', description: ' Desc ' }],
            columns: [{ id: 'col', label: ' Col ', description: ' ' }],
          },
        },
      }),
    ).toEqual({ grid: { rows: [{ id: ' row ', label: 'Row', description: 'Desc' }], columns: [{ id: 'col', label: 'Col' }] } });
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'linearScale',
        settings: { linearScale: { min: 1, max: 5, minLabel: ' Low ', maxLabel: ' ' } },
      }),
    ).toEqual({ linearScale: { min: 1, max: 5, minLabel: 'Low' } });
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'starRating',
        settings: { starRating: { max: 5 } },
      }),
    ).toEqual({ starRating: { max: 5 } });
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'scheduling',
        settings: { scheduling: schedulingSettings({ inviteeMode: 'none', maxInvitees: 10 }) },
      }),
    ).toMatchObject({ scheduling: { hostName: 'Host', maxInvitees: 0, timezone: 'America/Sao_Paulo' } });
    expect(internals.normalizeElementSettings(savePoll().elements[0])).toBeUndefined();
  });

  it('normalizes optional setting fields and missing setting payloads', () => {
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'singleSelectionGrid',
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'singleSelectionGrid',
        settings: {},
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'linearScale',
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'linearScale',
        settings: { linearScale: { min: 0, max: 10, minLabel: ' ', maxLabel: ' High ' } },
      }),
    ).toEqual({ linearScale: { min: 0, max: 10, maxLabel: 'High' } });
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'starRating',
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'starRating',
        settings: {},
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'scheduling',
      }),
    ).toBeUndefined();
    expect(
      internals.normalizeElementSettings({
        ...savePoll().elements[0],
        type: 'scheduling',
        settings: { scheduling: schedulingSettings({ hostName: ' ', location: ' ', inviteeMode: 'optional' }) },
      }),
    ).toMatchObject({
      scheduling: {
        timezone: 'America/Sao_Paulo',
        inviteeMode: 'optional',
        maxInvitees: 2,
      },
    });
  });

  it('normalizes answers for every poll element type', () => {
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.SECTION }), 'ignored')).toBeNull();
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.STATEMENT }), 'ignored')).toBeNull();
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.SHORT_TEXT }), ' text ')).toBe('text');
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.LONG_TEXT }), 1)).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.SINGLE_CHOICE, options: [option('a'), option('b')] }), 'a'),
    ).toBe('a');
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.SELECTION_DROPDOWN, options: [option('a'), option('b')] }), ''),
    ).toBeNull();
    expect(() =>
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.SINGLE_CHOICE, options: [option('a')] }), 'x'),
    ).toThrow(BadRequestException);
    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.MULTIPLE_CHOICE, options: [option('a'), option('b')] }),
        ['a', 'a', '', 1, 'b'],
      ),
    ).toEqual(['a', 'b']);
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_CHOICE, options: [option('a')] }), 'a'),
    ).toBeNull();
    expect(() =>
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_CHOICE, options: [option('a')] }), ['x']),
    ).toThrow(BadRequestException);

    const gridSettings = {
      grid: {
        rows: [option('row-1', 'Row 1'), option('row-2', 'Row 2')],
        columns: [option('col-1'), option('col-2')],
      },
    };
    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings, required: true }),
        { 'row-1': 'col-1', 'row-2': 'col-2' },
      ),
    ).toEqual({ 'row-1': 'col-1', 'row-2': 'col-2' });
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings, required: true }),
        { 'row-1': 'col-1' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings }),
        { bad: 'col-1' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings }),
        { 'row-1': 'bad' },
      ),
    ).toThrow(BadRequestException);

    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings }),
        { 'row-1': ['col-1', 'col-1', ''], 'row-2': 'ignored' },
      ),
    ).toEqual({ 'row-1': ['col-1'] });
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings }),
        { 'row-1': ['bad'] },
      ),
    ).toThrow(BadRequestException);

    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: { linearScale: { min: 1, max: 5 } } }),
        '5',
      ),
    ).toBe(5);
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: { linearScale: { min: 1, max: 5 } } }),
        6,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: {} }), 'bad'),
    ).toThrow(BadRequestException);
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.STAR_RATING, settings: { starRating: { max: 5 } } }), '')).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.STAR_RATING, settings: { starRating: { max: 5 } } }), 5),
    ).toBe(5);
    expect(() =>
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.STAR_RATING, settings: { starRating: { max: 5 } } }), 0),
    ).toThrow(BadRequestException);
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.DATE }), '2026-06-24')).toBe('2026-06-24');
    expect(() => internals.normalizeAnswer(dbElement({ type: DbPollElementType.DATE }), '2026-02-31')).toThrow(
      BadRequestException,
    );
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.TIME }), '09:30')).toBe('09:30');
    expect(() => internals.normalizeAnswer(dbElement({ type: DbPollElementType.TIME }), '25:00')).toThrow(BadRequestException);
  });

  it('normalizes scheduling answers and invitees', () => {
    const element = dbElement({
      type: DbPollElementType.SCHEDULING,
      settings: { scheduling: schedulingSettings() },
    });
    expect(internals.buildSchedulingSlots(schedulingSettings())).toEqual([
      { id: 'window-1:09:05' },
      { id: 'window-1:09:35' },
      { id: 'window-1:10:05' },
    ]);
    expect(
      internals.normalizeAnswer(element, {
        slotId: ' window-1:09:05 ',
        invitees: [{ name: ' Grace ', email: ' grace@example.com ' }, {}, null],
      }),
    ).toEqual({
      slotId: 'window-1:09:05',
      invitees: [{ name: 'Grace', email: 'grace@example.com' }],
    });
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.SCHEDULING, settings: {} }), {})).toBeNull();
    expect(internals.normalizeAnswer(element, { slotId: ' ' })).toBeNull();
    expect(() => internals.normalizeAnswer(element, { slotId: 'bad-slot' })).toThrow(BadRequestException);
    expect(() => internals.normalizeAnswer(element, { slotId: 'window-1:09:05', invitees: 'invalid' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      internals.normalizeAnswer(element, { slotId: 'window-1:09:05', invitees: [{ email: 'grace@example.com' }] }),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(element, { slotId: 'window-1:09:05', invitees: [{ name: 'Grace', email: 'bad' }] }),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(element, {
        slotId: 'window-1:09:05',
        invitees: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(
        dbElement({
          type: DbPollElementType.SCHEDULING,
          settings: { scheduling: schedulingSettings({ inviteeMode: 'required', maxInvitees: 1 }) },
        }),
        { slotId: 'window-1:09:05', invitees: [] },
      ),
    ).toThrow(BadRequestException);
    expect(
      internals.normalizeAnswer(
        dbElement({
          type: DbPollElementType.SCHEDULING,
          settings: { scheduling: schedulingSettings({ inviteeMode: 'none', maxInvitees: 0 }) },
        }),
        { slotId: 'window-1:09:05', invitees: [{ name: 'Ignored' }] },
      ),
    ).toEqual({ slotId: 'window-1:09:05', invitees: [] });
  });

  it('validates full response payloads', () => {
    const poll = pollRecord({
      elements: [
        dbElement({ id: 'required', title: 'Required', required: true }),
        dbElement({ id: 'optional', title: 'Optional', required: false }),
      ],
    });

    expect(
      internals.validateResponse(poll, {
        answers: [
          { elementId: 'required', value: ' answer ' },
          { elementId: 'optional', value: ' ' },
        ],
      }),
    ).toEqual([{ elementId: 'required', value: 'answer' }]);
    expect(() => internals.validateResponse(poll, { answers: [{ elementId: 'unknown', value: 'x' }] })).toThrow(
      BadRequestException,
    );
    expect(() => internals.validateResponse(poll, { answers: [{ elementId: 'required', value: ' ' }] })).toThrow(
      BadRequestException,
    );
  });

  it('resolves poll metadata, visibility, response options, and import parsing helpers', async () => {
    await expect(
      internals.resolvePollMetadata(savePoll({ voterEligibilitySource: 'eventAttendance' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      internals.resolvePollMetadata(savePoll({ linkedEventId: 'missing', voterEligibilitySource: 'eventAttendance' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    eventManager.listLinkableEvents.mockResolvedValueOnce([
      {
        id: 'event-1',
        name: 'Bad',
        startDate: 'bad-date',
        endDate: '2026-06-21T12:00:00.000Z',
        shouldCollectAttendance: true,
      },
    ]);
    await expect(
      internals.resolvePollMetadata(savePoll({ linkedEventId: 'event-1', voterEligibilitySource: 'eventAttendance' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(internals.resolvePollMetadata(savePoll({ voterEligibilitySource: 'computerScienceStudents', requireVerifiedUnespRole: true }))).resolves.toMatchObject({
      voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
      requireVerifiedUnespRole: true,
    });
    expect(internals.resolvePollResultVisibility({ ...savePoll(), resultsPublic: false, resultsLive: true })).toEqual({
      resultsPublic: false,
      resultsLive: false,
    });
    expect(internals.resolvePollResultVisibility(savePoll({}), { resultsPublic: true, resultsLive: true })).toEqual({
      resultsPublic: false,
      resultsLive: false,
    });
    expect(
      internals.resolvePollResponseOptions(
        savePoll({ allowMultipleResponses: true, allowResponseEditing: true }),
        undefined,
        DbPollVotingStyle.SECRET,
      ),
    ).toEqual({ allowMultipleResponses: true, allowResponseEditing: false });
    expect(
      internals.resolvePollResponseOptions(savePoll({ allowResponseEditing: true }), undefined, DbPollVotingStyle.ANONYMOUS),
    ).toEqual({ allowMultipleResponses: false, allowResponseEditing: false });
    expect(internals.parseEligibilityImport({ format: 'txt', content: '1\n1\nbad' })).toEqual({
      enrollmentNumbers: ['1', 'bad'],
      duplicateCount: 1,
      invalidCount: 0,
    });
    expect(() => internals.parseEligibilityImport({ format: 'csv', content: '"a,b', selectedHeader: 'a' })).toThrow(
      BadRequestException,
    );
    expect(() => internals.parseEligibilityImport({ format: 'csv', content: 'a,a\n1,2', selectedHeader: 'a' })).toThrow(
      BadRequestException,
    );
    expect(() => internals.parseEligibilityImport({ format: 'csv', content: 'a,b\n1', selectedHeader: 'a' })).toThrow(
      BadRequestException,
    );
    expect(() => internals.parseEligibilityImport({ format: 'csv', content: '', selectedHeader: 'a' })).toThrow(
      BadRequestException,
    );
    expect(() => internals.parseEligibilityImport({ format: 'csv', content: 'a\n1', selectedHeader: 'missing' })).toThrow(
      BadRequestException,
    );
  });

  it('covers metadata defaults, optional event details, and inherited visibility options', async () => {
    const defaultInput = savePoll();
    delete defaultInput.votingStyle;
    delete defaultInput.voterEligibilitySource;
    delete defaultInput.requireVerifiedUnespRole;
    await expect(internals.resolvePollMetadata(defaultInput)).resolves.toEqual({
      votingStyle: DbPollVotingStyle.SECRET,
      voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      requireVerifiedUnespRole: false,
      linkedEventId: null,
      linkedEventName: null,
      linkedEventStartDate: null,
      linkedEventEndDate: null,
      linkedEventLocationDescription: null,
    });

    eventManager.listLinkableEvents.mockResolvedValueOnce([
      {
        id: 'event-1',
        name: 'CACiC',
        startDate: '2026-06-21T10:00:00.000Z',
        endDate: '2026-06-21T12:00:00.000Z',
        shouldCollectAttendance: true,
      },
    ]);
    await expect(
      internals.resolvePollMetadata(
        savePoll({
          linkedEventId: 'event-1',
          voterEligibilitySource: 'eventAttendanceComputerScienceStudents',
          requireVerifiedUnespRole: true,
        }),
      ),
    ).resolves.toMatchObject({
      voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS,
      requireVerifiedUnespRole: true,
      linkedEventLocationDescription: null,
    });

    expect(internals.resolvePollResultVisibility({} as SavePollDto, undefined)).toEqual({
      resultsPublic: false,
      resultsLive: false,
    });
    expect(internals.resolvePollResultVisibility({ resultsPublic: true } as SavePollDto, undefined)).toEqual({
      resultsPublic: true,
      resultsLive: false,
    });
    expect(internals.resolvePollResultVisibility({ resultsPublic: true, resultsLive: true } as SavePollDto, undefined)).toEqual({
      resultsPublic: true,
      resultsLive: true,
    });
    expect(internals.resolvePollResultVisibility({} as SavePollDto, { resultsPublic: true, resultsLive: true })).toEqual({
      resultsPublic: true,
      resultsLive: true,
    });
    expect(
      internals.resolvePollResponseOptions({} as SavePollDto, undefined, DbPollVotingStyle.SECRET),
    ).toEqual({ allowMultipleResponses: false, allowResponseEditing: false });
    expect(
      internals.resolvePollResponseOptions(
        {} as SavePollDto,
        { allowMultipleResponses: false, allowResponseEditing: true },
        DbPollVotingStyle.SECRET,
      ),
    ).toEqual({ allowMultipleResponses: false, allowResponseEditing: true });
  });

  it('covers parser fallback branches for blank rows and non-string enrollment values', () => {
    expect(
      internals.parseEligibilityImport({
        format: 'csv',
        content: 'matricula,nome\n\n20240001,Ada\n',
        selectedHeader: 'matricula',
      }),
    ).toEqual({ enrollmentNumbers: ['20240001'], duplicateCount: 0, invalidCount: 0 });
    expect(internals.normalizeEnrollmentNumbers([{}, null, Number.NaN, ''.padEnd(65, '1')])).toEqual({
      enrollmentNumbers: [],
      duplicateCount: 0,
      invalidCount: 1,
    });
  });

  it('maps contract and database enum values in both directions', () => {
    expect(['draft', 'published', 'closed'].map((status) => internals.toDbStatus(status))).toEqual([
      DbPollStatus.DRAFT,
      DbPollStatus.PUBLISHED,
      DbPollStatus.CLOSED,
    ]);
    expect([DbPollStatus.DRAFT, DbPollStatus.PUBLISHED, DbPollStatus.CLOSED].map((status) => internals.toContractStatus(status))).toEqual([
      'draft',
      'published',
      'closed',
    ]);
    expect(['public', 'partiallySecret', 'secret', 'anonymous'].map((style) => internals.toDbVotingStyle(style))).toEqual([
      DbPollVotingStyle.PUBLIC,
      DbPollVotingStyle.PARTIALLY_SECRET,
      DbPollVotingStyle.SECRET,
      DbPollVotingStyle.ANONYMOUS,
    ]);
    expect(
      [DbPollVotingStyle.PUBLIC, DbPollVotingStyle.PARTIALLY_SECRET, DbPollVotingStyle.SECRET, DbPollVotingStyle.ANONYMOUS].map(
        (style) => internals.toContractVotingStyle(style),
      ),
    ).toEqual(['public', 'partiallySecret', 'secret', 'anonymous']);
    expect(
      [
        'authenticatedUsers',
        'unespUsers',
        'computerScienceStudents',
        'eventAttendance',
        'eventAttendanceUnespUsers',
        'eventAttendanceComputerScienceStudents',
        'enrollmentList',
      ].map((source) => internals.toDbVoterEligibilitySource(source)),
    ).toEqual([
      DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
      DbPollVoterEligibilitySource.UNESP_USERS,
      DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
      DbPollVoterEligibilitySource.EVENT_ATTENDANCE,
      DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS,
      DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS,
      DbPollVoterEligibilitySource.ENROLLMENT_LIST,
    ]);
    expect(
      [
        DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
        DbPollVoterEligibilitySource.UNESP_USERS,
        DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
        DbPollVoterEligibilitySource.EVENT_ATTENDANCE,
        DbPollVoterEligibilitySource.EVENT_ATTENDANCE_UNESP_USERS,
        DbPollVoterEligibilitySource.EVENT_ATTENDANCE_COMPUTER_SCIENCE_STUDENTS,
        DbPollVoterEligibilitySource.ENROLLMENT_LIST,
      ].map((source) => internals.toContractVoterEligibilitySource(source)),
    ).toEqual([
      'authenticatedUsers',
      'unespUsers',
      'computerScienceStudents',
      'eventAttendance',
      'eventAttendanceUnespUsers',
      'eventAttendanceComputerScienceStudents',
      'enrollmentList',
    ]);

    const contractElementTypes = [
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
    ];
    const dbElementTypes = [
      DbPollElementType.SECTION,
      DbPollElementType.STATEMENT,
      DbPollElementType.SHORT_TEXT,
      DbPollElementType.LONG_TEXT,
      DbPollElementType.SINGLE_CHOICE,
      DbPollElementType.MULTIPLE_CHOICE,
      DbPollElementType.SINGLE_SELECTION_GRID,
      DbPollElementType.MULTIPLE_SELECTION_GRID,
      DbPollElementType.SELECTION_DROPDOWN,
      DbPollElementType.LINEAR_SCALE,
      DbPollElementType.STAR_RATING,
      DbPollElementType.DATE,
      DbPollElementType.TIME,
      DbPollElementType.SCHEDULING,
    ];
    expect(contractElementTypes.map((type) => internals.toDbElementType(type))).toEqual(dbElementTypes);
    expect(dbElementTypes.map((type) => internals.toContractElementType(type))).toEqual(contractElementTypes);
  });

  it('maps full poll records and handles optional text/date helpers', () => {
    expect(
      internals.toContractPoll(
        pollRecord({
          description: 'Description',
          elements: [
            dbElement({
              type: DbPollElementType.LINEAR_SCALE,
              description: 'Scale',
              settings: { linearScale: { min: 1, max: 5 } },
            }),
            dbElement({
              id: 'rating',
              type: DbPollElementType.STAR_RATING,
              settings: { starRating: { max: 5 } },
            }),
            dbElement({
              id: 'schedule',
              type: DbPollElementType.SCHEDULING,
              settings: { scheduling: schedulingSettings() },
            }),
            dbElement({
              id: 'grid',
              type: DbPollElementType.SINGLE_SELECTION_GRID,
              settings: { grid: { rows: [option('row')], columns: [option('col')] } },
            }),
          ],
        }),
      ),
    ).toMatchObject({
      id: 'poll-1',
      description: 'Description',
      elements: [
        { type: 'linearScale', settings: { linearScale: { min: 1, max: 5 } } },
        { type: 'starRating', settings: { starRating: { max: 5 } } },
        { type: 'scheduling', settings: { scheduling: expect.any(Object) } },
        { type: 'singleSelectionGrid', settings: { grid: expect.any(Object) } },
      ],
    });
    expect(internals.cleanOptionalText(' text ')).toBe('text');
    expect(internals.cleanOptionalText(' ')).toBeUndefined();
    expect(internals.parseEventDate('2026-06-21T10:00:00.000Z', 'startDate')).toEqual(
      new Date('2026-06-21T10:00:00.000Z'),
    );
    expect(() => internals.parseEventDate('bad', 'startDate')).toThrow(BadRequestException);
    expect(internals.toPollResultsVoter({ id: 'user-1', name: 'Name', preferredUsername: 'pref', email: 'email', claims: null })).toEqual({
      userId: 'user-1',
      name: 'Name',
      preferredUsername: 'pref',
      email: 'email',
    });
  });

  it('maps nullable poll dates, linked-event locations, and blank voter claims', () => {
    expect(
      internals.toContractPoll(
        pollRecord({
          publishedAt: null,
          linkedEventId: 'event-1',
          linkedEventName: 'CACiC',
          linkedEventStartDate: new Date('2026-06-21T10:00:00.000Z'),
          linkedEventEndDate: new Date('2026-06-21T12:00:00.000Z'),
          linkedEventLocationDescription: null,
        }),
      ),
    ).toMatchObject({
      publishedAt: undefined,
      linkedEvent: {
        id: 'event-1',
        name: 'CACiC',
        startDate: '2026-06-21T10:00:00.000Z',
        endDate: '2026-06-21T12:00:00.000Z',
        locationDescription: undefined,
      },
    });
    expect(
      internals.toPollResultsVoter({
        id: 'user-1',
        name: null,
        preferredUsername: null,
        email: null,
        claims: {
          name: ' ',
          preferred_username: ' ',
          email: ' ',
          unesp_role: [' ', 'role-a'],
        },
      }),
    ).toEqual({
      userId: 'user-1',
      name: undefined,
      preferredUsername: undefined,
      email: undefined,
      unespRole: 'role-a',
    });
  });

  it('manages result subscribers and ignores publishes without listeners', () => {
    const firstListener = jest.fn();
    const secondListener = jest.fn();
    const unsubscribeFirst = internals.subscribeToPollResults('poll-1', firstListener);
    const unsubscribeSecond = internals.subscribeToPollResults('poll-1', secondListener);

    internals.publishPollResults({
      admin: { pollId: 'poll-1', responseCount: 1, responses: [] },
      public: { pollId: 'poll-1', responseCount: 1, responses: [] },
    });

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    internals.publishPollResults({
      admin: { pollId: 'poll-1', responseCount: 2, responses: [] },
      public: { pollId: 'poll-1', responseCount: 2, responses: [] },
    });
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    internals.publishPollResults({
      admin: { pollId: 'poll-1', responseCount: 3, responses: [] },
      public: { pollId: 'poll-1', responseCount: 3, responses: [] },
    });
    expect(secondListener).toHaveBeenCalledTimes(2);
  });

  it('publishes submitted responses to active subscribers', async () => {
    const listener = jest.fn();
    const unsubscribe = internals.subscribeToPollResults('poll-1', listener);
    prisma.poll.findFirst.mockResolvedValue(pollRecord());
    prisma.pollVoter.findUnique.mockResolvedValue(null);
    prisma.pollResponse.create.mockResolvedValue(responseRecord());
    prisma.pollResponse.count.mockResolvedValue(1);

    await service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser());

    expect(listener).toHaveBeenCalledWith({
      admin: {
        pollId: 'poll-1',
        responseCount: 1,
        responses: [expect.objectContaining({ id: 'response-1', submittedAt: '2026-06-21T12:00:00.000Z' })],
      },
      public: {
        pollId: 'poll-1',
        responseCount: 1,
        responses: [expect.objectContaining({ id: 'response-1', submittedAt: undefined, voter: undefined })],
      },
    });

    unsubscribe();
  });

  it('propagates non-unique persistence errors during response saves', async () => {
    prisma.poll.findFirst.mockResolvedValue(pollRecord());
    prisma.pollVoter.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      service.submitResponse('poll-1', { answers: [{ elementId: 'question-1', value: 'answer' }] }, createUser()),
    ).rejects.toThrow('db down');
  });

  it('creates poll element options with trimmed labels and descriptions', async () => {
    prisma.poll.create.mockResolvedValue({ id: 'poll-1' });
    prisma.poll.findUniqueOrThrow.mockResolvedValue(
      pollRecord({
        elements: [
          dbElement({
            type: DbPollElementType.SINGLE_CHOICE,
            options: [option('a', 'A'), option('b', 'B')],
          }),
        ],
      }),
    );

    await service.createPoll(
      savePoll({
        elements: [
          {
            id: 'choice',
            type: 'singleChoice',
            title: 'Choice',
            required: true,
            options: [
              { id: 'a', label: ' A ', description: ' First ' },
              { id: 'b', label: ' B ', description: ' ' },
            ],
          },
        ],
      }),
      createUser(),
    );

    expect(prisma.pollElement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        options: {
          create: [
            { id: 'a', label: 'A', description: 'First', position: 0 },
            { id: 'b', label: 'B', description: undefined, position: 1 },
          ],
        },
      }),
    });
  });

  it('covers remaining settings validation edge cases', () => {
    const base = savePoll().elements[0];
    const tooManyOptions = Array.from({ length: 81 }, (_, index) => option(`option-${index}`));

    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'singleSelectionGrid',
              settings: { grid: { rows: [option('row')], columns: tooManyOptions } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'singleSelectionGrid',
              settings: { grid: { rows: [option('row'), option('row')], columns: [option('a'), option('b')] } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'singleSelectionGrid',
              settings: { grid: { rows: [{ ...option('row'), label: ' ' }], columns: [option('a'), option('b')] } },
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'linearScale' }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'singleSelectionGrid' }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'starRating' }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, type: 'scheduling' }] })),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validatePollInput(savePoll({ elements: [{ ...base, settings: { linearScale: { min: 1, max: 5 } } }] })),
    ).toThrow(BadRequestException);

    for (const invalidScheduling of [
      { durationMinutes: 4 },
      { slotIntervalMinutes: 4 },
      { bufferBeforeMinutes: -1 },
      { bufferAfterMinutes: 121 },
      { inviteeMode: 'required', maxInvitees: 0 },
      {
        availability: Array.from({ length: 121 }, (_, index) => ({
          id: `window-${index}`,
          date: '2026-06-24',
          startTime: '09:00',
          endTime: '11:00',
        })),
      },
      { availability: [{ id: ' ', date: '2026-06-24', startTime: '09:00', endTime: '11:00' }] },
      {
        availability: [
          { id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '11:00' },
          { id: 'window-1', date: '2026-06-24', startTime: '12:00', endTime: '13:00' },
        ],
      },
      { availability: [{ id: 'window-1', date: '2026-06-24', startTime: '11:00', endTime: '09:00' }] },
      { availability: [{ id: 'window-1', date: '2026-06-24', startTime: '09:00', endTime: '09:20' }] },
    ]) {
      expect(() =>
        internals.validatePollInput(
          savePoll({
            elements: [
              {
                ...base,
                type: 'scheduling',
                settings: { scheduling: schedulingSettings(invalidScheduling) },
              },
            ],
          }),
        ),
      ).toThrow(BadRequestException);
    }
  });

  it('parses CRLF CSV rows with escaped quotes and tab delimiters', () => {
    expect(
      internals.parseEligibilityImport({
        format: 'csv',
        content: 'matricula\tnome\r\n20240001\t"Ada ""Countess"""',
        selectedHeader: 'matricula',
      }),
    ).toEqual({ enrollmentNumbers: ['20240001'], duplicateCount: 0, invalidCount: 0 });
  });

  it('covers remaining claim parsing eligibility branches', async () => {
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.UNESP_USERS }),
        createUser({
          email: undefined,
          claims: { secondary_emails: '["ada@unesp.br","ada@example.com"]' },
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({
          voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS,
          requireVerifiedUnespRole: true,
        }),
        createUser({
          claims: {
            academicId: '99123456',
            attributes: {
              unespRole: ['aluno-graduacao'],
              is_unesp_role_verified: 'true',
            },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS }),
        createUser({ claims: { enrollmentNumber: '12', unesp_role: 'aluno-graduacao' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS }),
        createUser({ claims: { unesp_role: 'aluno-graduacao' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.COMPUTER_SCIENCE_STUDENTS }),
        createUser({ claims: { enrollmentNumber: '24123456', unespRole: '["not-undergrad"]' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.EVENT_ATTENDANCE, linkedEventId: 'event-1' }),
        createUser(),
      ),
    ).resolves.toBeUndefined();

    prisma.pollEligibilityEnrollment.findUnique.mockResolvedValueOnce(null);
    await expect(
      internals.ensureVotingAllowed(
        pollRecord({ voterEligibilitySource: DbPollVoterEligibilitySource.ENROLLMENT_LIST }),
        createUser({ claims: { enrollmentNumber: ''.padEnd(65, '1') } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('streams published result events after subscription catch-up is empty', async () => {
    prisma.poll.findUnique.mockResolvedValue({
      id: 'poll-1',
      status: DbPollStatus.PUBLISHED,
      votingStyle: DbPollVotingStyle.SECRET,
      resultsPublic: true,
      resultsLive: true,
    });
    prisma.pollResponse.count.mockResolvedValue(0);
    prisma.pollResponse.findMany.mockResolvedValue([]);

    const events: unknown[] = [];
    const subscription = service.streamAdminPollResults('poll-1', 0).subscribe((event) => events.push(event));
    for (let index = 0; index < 10 && !internals.resultSubscribers.has('poll-1'); index += 1) {
      await Promise.resolve();
    }
    internals.publishPollResults({
      admin: { pollId: 'poll-1', responseCount: 1, responses: [{ id: 'response-1' }] },
      public: { pollId: 'poll-1', responseCount: 1, responses: [] },
    });

    expect(events).toEqual([{
      data: { pollId: 'poll-1', responseCount: 1, responses: [{ id: 'response-1' }] },
    }]);
    subscription.unsubscribe();
  });

  it('stops public result streams when live results are revoked after subscription', async () => {
    prisma.poll.findUnique
      .mockResolvedValueOnce({
        id: 'poll-1',
        status: DbPollStatus.PUBLISHED,
        votingStyle: DbPollVotingStyle.SECRET,
        voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
        requireVerifiedUnespRole: false,
        linkedEventId: null,
        resultsPublic: true,
        resultsLive: true,
      })
      .mockResolvedValueOnce({
        id: 'poll-1',
        status: DbPollStatus.PUBLISHED,
        votingStyle: DbPollVotingStyle.SECRET,
        voterEligibilitySource: DbPollVoterEligibilitySource.AUTHENTICATED_USERS,
        requireVerifiedUnespRole: false,
        linkedEventId: null,
        resultsPublic: false,
        resultsLive: false,
      });
    prisma.pollResponse.count.mockResolvedValue(0);
    prisma.pollResponse.findMany.mockResolvedValue([]);

    const events: unknown[] = [];
    const errors: unknown[] = [];
    const subscription = service.streamPublicPollResults('poll-1', 0, createUser()).subscribe({
      next: (event) => events.push(event),
      error: (error) => errors.push(error),
    });
    for (let index = 0; index < 10 && !internals.resultSubscribers.has('poll-1'); index += 1) {
      await Promise.resolve();
    }

    internals.publishPollResults({
      admin: { pollId: 'poll-1', responseCount: 1, responses: [{ id: 'response-1' }] },
      public: { pollId: 'poll-1', responseCount: 1, responses: [] },
    });
    for (let index = 0; index < 10 && errors.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(events).toEqual([]);
    expect(errors[0]).toBeInstanceOf(ForbiddenException);
    subscription.unsubscribe();
  });

  it('accepts valid grid, scale, and rating settings', () => {
    const base = savePoll().elements[0];

    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [
            {
              ...base,
              type: 'singleSelectionGrid',
              settings: { grid: { rows: [option('row')], columns: [option('a'), option('b')] } },
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [{ ...base, type: 'linearScale', settings: { linearScale: { min: 1, max: 5 } } }],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      internals.validatePollInput(
        savePoll({
          elements: [{ ...base, type: 'starRating', settings: { starRating: { max: 5 } } }],
        }),
      ),
    ).not.toThrow();
  });

  it('covers empty enrollment enrichment and result-voter fallbacks', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    prisma.pollEligibilityEnrollment.findMany.mockResolvedValue([]);

    await expect(service.listEligibilityEnrollments('poll-1')).resolves.toEqual({ totalCount: 0, entries: [] });
    expect(eventManager.lookupPeopleByEnrollmentNumbers).not.toHaveBeenCalled();

    expect(
      internals.toPollResultsVoter({
        id: 'user-1',
        name: null,
        preferredUsername: null,
        email: null,
        claims: {
          name: ' Ada ',
          preferred_username: ' ada ',
          email: ' ada@example.com ',
          academic_id: 12345,
          unespRole: 'role-a, role-b',
        },
      }),
    ).toEqual({
      userId: 'user-1',
      name: 'Ada',
      preferredUsername: 'ada',
      email: 'ada@example.com',
      unespRole: 'role-a, role-b',
      enrollmentNumber: '12345',
    });
  });

  it('covers remaining answer normalization empty cases', () => {
    const gridSettings = {
      grid: {
        rows: [option('row-1', 'Row 1')],
        columns: [option('col-1')],
      },
    };

    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: null }), {})).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings }), {
        'row-1': '',
      }),
    ).toBeNull();
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: null }), {})).toBeNull();
    expect(() =>
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings }), {
        bad: ['col-1'],
      }),
    ).toThrow(BadRequestException);
    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: { linearScale: { min: 1, max: 5 } } }),
        null,
      ),
    ).toBeNull();
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.DATE }), 1)).toBeNull();
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.TIME }), 1)).toBeNull();
    expect(
      internals.buildSchedulingSlots({
        durationMinutes: 30,
        slotIntervalMinutes: 30,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 5,
        availability: [{ id: 'short', date: '2026-06-24', startTime: '09:00', endTime: '09:10' }],
      }),
    ).toEqual([]);
    expect(() => internals.normalizeAnswer(dbElement({ type: DbPollElementType.DATE }), 'not-date')).toThrow(
      BadRequestException,
    );
    expect(internals.parseStringList(' ')).toEqual([]);
    expect(internals.parseStringList('[bad-json')).toEqual(['[bad-json']);
  });

  it('covers answer normalization fallback branches', () => {
    const gridSettings = {
      grid: {
        rows: [option('row-1', 'Row 1'), option('row-2', 'Row 2')],
        columns: [option('col-1'), option('col-2')],
      },
    };

    expect(
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.MULTIPLE_CHOICE, options: [option('a'), option('b')] }),
        ['', 1],
      ),
    ).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings }), {
        'row-1': [],
      }),
    ).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings }), {
        'row-1': 'ignored',
      }),
    ).toBeNull();
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.SINGLE_SELECTION_GRID, settings: gridSettings, required: true }),
        { 'row-1': '', 'row-2': 'col-2' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.MULTIPLE_SELECTION_GRID, settings: gridSettings, required: true }),
        { 'row-1': [], 'row-2': ['col-2'] },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.ensureRequiredGridRows(
        { required: true, title: 'Grid' },
        [option('row-1', 'Row 1')],
        { 'row-1': [] },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.ensureRequiredGridRows(
        { required: true, title: 'Grid' },
        [option('row-1', 'Row 1')],
        { 'row-1': '' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.ensureRequiredGridRows(
        { required: false, title: 'Grid' },
        [option('row-1', 'Row 1')],
        {},
      ),
    ).not.toThrow();
    expect(() =>
      internals.normalizeAnswer(
        dbElement({ type: DbPollElementType.LINEAR_SCALE, settings: { linearScale: { min: 1, max: 5 } } }),
        ' ',
      ),
    ).toThrow(BadRequestException);
    expect(internals.normalizeAnswer(dbElement({ type: DbPollElementType.SCHEDULING, settings: { scheduling: schedulingSettings() } }), { slotId: 1 })).toBeNull();
    expect(
      internals.normalizeAnswer(dbElement({ type: DbPollElementType.SCHEDULING, settings: { scheduling: schedulingSettings() } }), {
        slotId: 'window-1:09:05',
      }),
    ).toEqual({ slotId: 'window-1:09:05', invitees: [] });
  });

  it('treats missing optional answers and empty objects as empty responses', () => {
    expect(
      internals.validateResponse(
        pollRecord({
          elements: [
            dbElement({
              id: 'grid',
              type: DbPollElementType.MULTIPLE_SELECTION_GRID,
              settings: {
                grid: {
                  rows: [option('row')],
                  columns: [option('col')],
                },
              },
            }),
          ],
        }),
        { answers: [] },
      ),
    ).toEqual([]);
    expect(
      internals.validateResponse(
        pollRecord({
          elements: [
            dbElement({
              id: 'grid',
              type: DbPollElementType.SINGLE_SELECTION_GRID,
              settings: {
                grid: {
                  rows: [option('row')],
                  columns: [option('col')],
                },
              },
            }),
          ],
        }),
        { answers: [{ elementId: 'grid', value: {} }] },
      ),
    ).toEqual([]);
    expect(internals.isEmptyAnswer(null)).toBe(true);
    expect(internals.isEmptyAnswer('')).toBe(true);
    expect(internals.isEmptyAnswer([])).toBe(true);
    expect(internals.isEmptyAnswer(['value'])).toBe(false);
    expect(internals.isEmptyAnswer({})).toBe(true);
    expect(internals.isEmptyAnswer({ value: true })).toBe(false);
  });

  it('maps option descriptions when converting records', () => {
    expect(
      internals.toContractPoll(
        pollRecord({
          elements: [
            dbElement({
              type: DbPollElementType.SINGLE_CHOICE,
              options: [{ ...option('a', 'A'), description: 'Option A' }],
            }),
          ],
        }),
      ),
    ).toMatchObject({
      elements: [
        {
          options: [{ id: 'a', label: 'A', description: 'Option A' }],
        },
      ],
    });
  });
});
