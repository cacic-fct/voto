import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CacicElectionSlateMemberIdentifierType as DbCacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole as DbCacicElectionSlateMemberRole,
} from '@prisma/client';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import {
  toContractCacicElectionSlateMemberIdentifierType,
  toDbCacicElectionSlateMemberIdentifierType,
  toDbCacicElectionSlateMemberRole,
} from './poll-cacic-election.mapper';
import {
  CACIC_ELECTION_REQUIRED_ROLES,
  CacicElectionSlateMemberInput,
  MIN_CACIC_ELECTION_SLATE_MEMBERS,
  NormalizedCacicElectionSlateMember,
} from './poll-cacic-election.types';
import { cleanOptionalText } from './poll-contract.mapper';
import { normalizeEnrollmentNumber } from './poll-user-claims';

@Injectable()
export class PollCacicElectionSlateValidatorService {
  private readonly logger = new Logger(PollCacicElectionSlateValidatorService.name);

  constructor(private readonly accountManager: AccountManagerIntegrationService) {}

  normalizeSlateName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException('Slate name is required.');
    }

    return name;
  }

  async normalizeCacicElectionSlateMembers(
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

    const role = toDbCacicElectionSlateMemberRole(member.role);
    const customRole = cleanOptionalText(member.customRole) ?? null;
    if (role === DbCacicElectionSlateMemberRole.OTHER && !customRole) {
      throw new BadRequestException('Custom role is required for other slate member roles.');
    }

    if (role !== DbCacicElectionSlateMemberRole.OTHER && customRole) {
      throw new BadRequestException('Custom role is only allowed for other slate member roles.');
    }

    const identifierType = toDbCacicElectionSlateMemberIdentifierType(member.identifierType);
    return {
      id: member.id,
      fullName,
      enrollmentNumber: normalizeEnrollmentNumber(member.enrollmentNumber ?? '') ?? null,
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
          identifierType: toContractCacicElectionSlateMemberIdentifierType(member.identifierType),
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
}
