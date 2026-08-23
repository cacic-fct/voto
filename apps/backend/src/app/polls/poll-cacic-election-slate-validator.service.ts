import { BadRequestException, Injectable } from '@nestjs/common';
import type { AccountManagerPerson } from '@org/voting-contracts';
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
    this.assertCanonicalMemberUniqueness(members);
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

    await this.verifySlateMembers(members);
    return members;
  }

  private assertCanonicalMemberUniqueness(members: readonly NormalizedCacicElectionSlateMember[]): void {
    const seenIdentifiers = new Set<string>();
    const seenEnrollments = new Set<string>();
    for (const member of members) {
      const identifierKey = `${member.identifierType}:${member.identifierValue}`;
      if (seenIdentifiers.has(identifierKey)) {
        throw new BadRequestException('A CACiC election slate cannot repeat a member identifier.');
      }
      seenIdentifiers.add(identifierKey);

      if (member.enrollmentNumber) {
        if (seenEnrollments.has(member.enrollmentNumber)) {
          throw new BadRequestException('A CACiC election slate cannot repeat an enrollment number.');
        }
        seenEnrollments.add(member.enrollmentNumber);
      }
    }
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
        if (!this.isValidCpf(digits)) {
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

  private async verifySlateMembers(
    members: readonly NormalizedCacicElectionSlateMember[],
  ): Promise<void> {
    const peopleByRequestId = await this.accountManager.lookupPeopleByIdentifiers(
      members.map((member, index) => ({
        requestId: `member-${index}`,
        identifierType: toContractCacicElectionSlateMemberIdentifierType(member.identifierType),
        identifierValue: member.identifierValue,
      })),
    );
    const seenPeople = new Set<string>();
    for (const [index, member] of members.entries()) {
      const people = peopleByRequestId.get(`member-${index}`) ?? [];
      if (people.length !== 1) {
        throw new BadRequestException('Each slate member must match exactly one Account Manager identity.');
      }

      const [person] = people;
      this.assertMatchingPerson(member, person);
      const personKey = person.userId ?? `${person.email ?? ''}:${person.enrollmentNumber ?? ''}`;
      if (seenPeople.has(personKey)) {
        throw new BadRequestException('A CACiC election slate cannot repeat the same person.');
      }
      seenPeople.add(personKey);
    }
  }

  private assertMatchingPerson(member: NormalizedCacicElectionSlateMember, person: AccountManagerPerson): void {
    if (this.normalizeComparisonText(person.name) !== this.normalizeComparisonText(member.fullName)) {
      throw new BadRequestException('Slate member name does not match the verified Account Manager identity.');
    }
    if (
      member.enrollmentNumber &&
      normalizeEnrollmentNumber(person.enrollmentNumber ?? '') !== member.enrollmentNumber
    ) {
      throw new BadRequestException('Slate member enrollment does not match the verified Account Manager identity.');
    }
  }

  private normalizeComparisonText(value: string): string {
    return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private isValidCpf(value: string): boolean {
    if (value.length !== 11 || /^([0-9])\1{10}$/.test(value)) return false;
    const digits = value.split('').map(Number);
    const calculate = (length: number): number => {
      const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return calculate(9) === digits[9] && calculate(10) === digits[10];
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }
}
