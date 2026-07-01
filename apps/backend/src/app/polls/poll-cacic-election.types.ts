import { SubmitCacicElectionSlateMemberRequest } from '@org/voting-contracts';
import {
  CacicElectionSlateMemberIdentifierType as DbCacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole as DbCacicElectionSlateMemberRole,
  Prisma,
} from '@prisma/client';

export type CacicElectionSlateRecord = Prisma.CacicElectionSlateGetPayload<{
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

export type CacicElectionSlateMemberInput = SubmitCacicElectionSlateMemberRequest & {
  id?: string;
};

export type NormalizedCacicElectionSlateMember = {
  id?: string;
  fullName: string;
  enrollmentNumber: string | null;
  role: DbCacicElectionSlateMemberRole;
  customRole: string | null;
  isRepresentative: boolean;
  identifierType: DbCacicElectionSlateMemberIdentifierType;
  identifierValue: string;
};

export type CacicElectionSlateListOptions = {
  includePrivateIdentifiers: boolean;
};

export const MIN_CACIC_ELECTION_SLATE_MEMBERS = 6;

export const CACIC_ELECTION_REQUIRED_ROLES = [
  DbCacicElectionSlateMemberRole.PRESIDENT,
  DbCacicElectionSlateMemberRole.VICE_PRESIDENT,
  DbCacicElectionSlateMemberRole.FINANCIAL_DIRECTOR,
  DbCacicElectionSlateMemberRole.COMMUNICATION_DIRECTOR,
  DbCacicElectionSlateMemberRole.EVENTS_DIRECTOR,
  DbCacicElectionSlateMemberRole.PUBLIC_RELATIONS_DIRECTOR,
] as const;
