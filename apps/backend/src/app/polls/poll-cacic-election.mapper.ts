import {
  AdminCacicElectionSlate,
  CacicElectionSlate,
  CacicElectionSlateMember,
  CacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole,
  CacicElectionSlateStatus,
} from '@org/voting-contracts';
import {
  CacicElectionSlateMemberIdentifierType as DbCacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole as DbCacicElectionSlateMemberRole,
  CacicElectionSlateStatus as DbCacicElectionSlateStatus,
  CacicElectionSlateSubmissionSource as DbCacicElectionSlateSubmissionSource,
  Prisma,
} from '@prisma/client';
import { CacicElectionSlateListOptions, CacicElectionSlateRecord } from './poll-cacic-election.types';

export function cacicElectionSlateInclude(): Prisma.CacicElectionSlateInclude {
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

export function toContractCacicElectionSlate(
  slate: CacicElectionSlateRecord,
  options: { includePrivateIdentifiers: true },
): AdminCacicElectionSlate;
export function toContractCacicElectionSlate(
  slate: CacicElectionSlateRecord,
  options: { includePrivateIdentifiers: false },
): CacicElectionSlate;
export function toContractCacicElectionSlate(
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
      ...(member.enrollmentNumber ? { enrollmentYear: deriveEnrollmentYear(member.enrollmentNumber) } : {}),
      role: toContractCacicElectionSlateMemberRole(member.role),
      ...(member.customRole ? { customRole: member.customRole } : {}),
      isRepresentative: member.isRepresentative,
    };

    if (!options.includePrivateIdentifiers) {
      return baseMember;
    }

    return {
      ...baseMember,
      ...(member.enrollmentNumber ? { enrollmentNumber: member.enrollmentNumber } : {}),
      identifierType: toContractCacicElectionSlateMemberIdentifierType(member.identifierType),
      identifierValue: member.identifierValue,
    };
  });

  return {
    id: slate.id,
    pollId: slate.pollId,
    name: slate.name,
    status: toContractCacicElectionSlateStatus(slate.status),
    enabled: slate.enabled,
    ...(slate.rejectionReason ? { rejectionReason: slate.rejectionReason } : {}),
    submissionSource: toContractCacicElectionSlateSubmissionSource(slate.submissionSource),
    ...(submittedBy ? { submittedBy } : {}),
    submittedAt: slate.submittedAt.toISOString(),
    reviewedAt: slate.reviewedAt?.toISOString(),
    members,
  } as AdminCacicElectionSlate | CacicElectionSlate;
}

export function toDbCacicElectionSlateStatus(status: CacicElectionSlateStatus): DbCacicElectionSlateStatus {
  switch (status) {
    case 'pending':
      return DbCacicElectionSlateStatus.PENDING;
    case 'approved':
      return DbCacicElectionSlateStatus.APPROVED;
    case 'rejected':
      return DbCacicElectionSlateStatus.REJECTED;
  }
}

function toContractCacicElectionSlateStatus(status: DbCacicElectionSlateStatus): CacicElectionSlateStatus {
  switch (status) {
    case DbCacicElectionSlateStatus.PENDING:
      return 'pending';
    case DbCacicElectionSlateStatus.APPROVED:
      return 'approved';
    case DbCacicElectionSlateStatus.REJECTED:
      return 'rejected';
  }
}

function toContractCacicElectionSlateSubmissionSource(
  source: DbCacicElectionSlateSubmissionSource,
): CacicElectionSlate['submissionSource'] {
  switch (source) {
    case DbCacicElectionSlateSubmissionSource.PUBLIC:
      return 'public';
    case DbCacicElectionSlateSubmissionSource.ADMIN:
      return 'admin';
  }
}

export function toDbCacicElectionSlateMemberRole(role: CacicElectionSlateMemberRole): DbCacicElectionSlateMemberRole {
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

function toContractCacicElectionSlateMemberRole(role: DbCacicElectionSlateMemberRole): CacicElectionSlateMemberRole {
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

export function toDbCacicElectionSlateMemberIdentifierType(
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

export function toContractCacicElectionSlateMemberIdentifierType(
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

export function cacicElectionSlateOptionId(slateId: string): string {
  return `slate:${slateId}`;
}

function deriveEnrollmentYear(enrollmentNumber: string): string | undefined {
  const digits = enrollmentNumber.replace(/\D/g, '');
  return digits.length >= 2 ? digits.slice(0, 2) : undefined;
}
