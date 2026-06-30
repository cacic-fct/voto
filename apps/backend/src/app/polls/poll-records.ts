import { PollResultsDelta } from '@org/voting-contracts';
import {
  PollElementType as DbPollElementType,
  PollImagePlacement as DbPollImagePlacement,
  PollStatus as DbPollStatus,
  PollVoterEligibilitySource as DbPollVoterEligibilitySource,
  PollVotingStyle as DbPollVotingStyle,
  Prisma,
} from '@prisma/client';

export type PollRecord = {
  id: string;
  title: string;
  description: string | null;
  status: DbPollStatus;
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
  elements: ElementRecord[];
  images?: ImageRecord[];
  _count?: {
    responses: number;
  };
};

export type ElementRecord = {
  id: string;
  type: DbPollElementType;
  title: string;
  description: string | null;
  required: boolean;
  settings: Prisma.JsonValue | null;
  position: number;
  retiredAt?: Date | null;
  options: OptionRecord[];
};

export type OptionRecord = {
  id: string;
  label: string;
  description: string | null;
  position: number;
};

export type ImageRecord = {
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

export type EligibilityEnrollmentRecord = {
  pollId: string;
  enrollmentNumber: string;
  createdAt: Date;
};

export type ParsedEligibilityEnrollments = {
  enrollmentNumbers: string[];
  duplicateCount: number;
  invalidCount: number;
};

export type PollMetadataData = {
  votingStyle: DbPollVotingStyle;
  voterEligibilitySource: DbPollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  linkedEventId: string | null;
  linkedEventName: string | null;
  linkedEventStartDate: Date | null;
  linkedEventEndDate: Date | null;
  linkedEventLocationDescription: string | null;
};

export type PollResultVisibilityData = {
  resultsPublic: boolean;
  resultsLive: boolean;
};

export type PollResponseOptionsData = {
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
};

export type PollDirectLinkData = {
  directLinkEnabled: boolean;
  directLinkToken: string | null;
};

export type PollImageReferenceData = {
  id: string;
  placement: 'POLL_DESCRIPTION' | 'ELEMENT_DESCRIPTION';
  elementId: string | null;
  position: number;
  altText?: string;
  caption?: string;
};

export type PollResultsMetadata = {
  id: string;
  status: DbPollStatus;
  votingStyle: DbPollVotingStyle;
  voterEligibilitySource: DbPollVoterEligibilitySource;
  requireVerifiedUnespRole: boolean;
  linkedEventId: string | null;
  resultsPublic: boolean;
  resultsLive: boolean;
};

export type PollEligibilityRecord = Pick<
  PollRecord,
  'id' | 'voterEligibilitySource' | 'requireVerifiedUnespRole' | 'linkedEventId'
>;

export type PollUserResponseStateRecord = {
  id: string;
  status: DbPollStatus;
  votingStyle: DbPollVotingStyle;
  allowResponseEditing: boolean;
  allowMultipleResponses: boolean;
};

export type PollContractOptions = {
  includeDirectLinkToken?: boolean;
  imageDirectLinkToken?: string;
};

export type PollResultResponseRecord = Prisma.PollResponseGetPayload<{
  include: {
    answers: {
      include: {
        element: {
          include: {
            options: {
              orderBy: {
                position: 'asc';
              };
            };
          };
        };
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

export type PollResultStreamEvent = {
  admin: PollResultsDelta;
  public: PollResultsDelta;
};

export const pollInclude = {
  elements: {
    where: { retiredAt: null },
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
