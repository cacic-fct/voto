import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountManagerPerson,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollEligibilityMutationMode,
} from '@org/voting-contracts';
import { PollStatus as DbPollStatus, Prisma, PollVoterEligibilitySource as DbPollVoterEligibilitySource } from '@prisma/client';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';
import { AccountManagerIntegrationService } from '../account-manager/account-manager-integration.service';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddPollEligibilityEnrollmentsDto, ImportPollEligibilityEnrollmentsDto } from './dto/poll.dto';
import {
  EligibilityEnrollmentRecord,
  ParsedEligibilityEnrollments,
  PollEligibilityRecord,
} from './poll-records';
import {
  hasComputerScienceEnrollmentPattern,
  hasNonEmptyRawValue,
  hasUndergraduateUnespRole,
  hasUnespEmail,
  hasVerifiedUnespRole,
  normalizeEnrollmentNumber,
  readUserEnrollmentNumber,
} from './poll-user-claims';

@Injectable()
export class PollEligibilityService {
  private readonly logger = new Logger(PollEligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventManager: EventManagerIntegrationService,
    private readonly featureFlags: FeatureFlagService,
    private readonly accountManager: AccountManagerIntegrationService,
  ) {}

  async listEligibilityEnrollments(
    pollId: string,
    options: { includePeople?: boolean } = {},
  ): Promise<PollEligibilityEnrollmentList> {
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

    return this.toEligibilityEnrollmentList(records, { includePeople: options.includePeople ?? true });
  }

  async addEligibilityEnrollments(
    pollId: string,
    input: AddPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    await this.assertEligibilityMutable(pollId);
    const parsed = this.normalizeEnrollmentNumbers(input.enrollmentNumbers);
    return this.replaceOrAppendEligibilityEnrollments(pollId, parsed, 'append', user.sub);
  }

  async importEligibilityEnrollments(
    pollId: string,
    input: ImportPollEligibilityEnrollmentsDto,
    user: AuthenticatedPrincipal,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    await this.assertEligibilityMutable(pollId);
    const parsed = this.parseEligibilityImport(input);
    return this.replaceOrAppendEligibilityEnrollments(pollId, parsed, input.mode ?? 'append', user.sub);
  }

  async deleteEligibilityEnrollment(pollId: string, enrollmentNumber: string): Promise<void> {
    await this.assertEligibilityMutable(pollId);
    const normalizedEnrollmentNumber = normalizeEnrollmentNumber(enrollmentNumber);
    if (!normalizedEnrollmentNumber) {
      throw new BadRequestException('Enrollment number is required.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assertEligibilityMutableWithClient(tx, pollId);
      await tx.pollEligibilityEnrollment.deleteMany({
        where: {
          pollId,
          enrollmentNumber: normalizedEnrollmentNumber,
        },
      });
      await tx.poll.update({ where: { id: pollId }, data: { updatedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async clearEligibilityEnrollments(pollId: string): Promise<PollEligibilityEnrollmentList> {
    await this.assertEligibilityMutable(pollId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertEligibilityMutableWithClient(tx, pollId);
      await tx.pollEligibilityEnrollment.deleteMany({ where: { pollId } });
      await tx.poll.update({ where: { id: pollId }, data: { updatedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return {
      entries: [],
      totalCount: 0,
    };
  }

  async ensureVotingAllowed(
    poll: PollEligibilityRecord,
    user: AuthenticatedVoter,
    client: Pick<PrismaService, 'pollEligibilityEnrollment'> | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
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
        await this.ensureEnrollmentListVotingAllowed(poll, user, client);
        return;
    }

    throw new ForbiddenException('Voting is not allowed for this poll.');
  }

  parseEligibilityImport(input: ImportPollEligibilityEnrollmentsDto): ParsedEligibilityEnrollments {
    switch (input.format) {
      case 'csv':
        return this.parseEligibilityCsvImport(input.content, input.selectedHeader);
      case 'txt':
        return this.parseEligibilityTxtImport(input.content);
    }
  }

  normalizeEnrollmentNumbers(rawValues: readonly unknown[]): ParsedEligibilityEnrollments {
    const enrollmentNumbers: string[] = [];
    const seen = new Set<string>();
    let duplicateCount = 0;
    let invalidCount = 0;

    for (const rawValue of rawValues) {
      const enrollmentNumber = normalizeEnrollmentNumber(rawValue);
      if (!enrollmentNumber) {
        if (hasNonEmptyRawValue(rawValue)) {
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
      await this.assertEligibilityMutableWithClient(tx, pollId);
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

      await tx.poll.update({
        where: { id: pollId },
        data: { updatedAt: new Date() },
      });

      return {
        createdCount: created.count,
        replacedCount: replaced.count,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
    const firstLine = csvContent.split(/\r?\n/, 1)[0] ?? '';
    const candidates = [',', ';', '\t'];
    return candidates.reduce((bestDelimiter, delimiter) => {
      const bestCount = this.countUnquotedDelimiter(firstLine, bestDelimiter);
      const candidateCount = this.countUnquotedDelimiter(firstLine, delimiter);
      return candidateCount > bestCount ? delimiter : bestDelimiter;
    }, ',');
  }

  private countUnquotedDelimiter(line: string, delimiter: string): number {
    let inQuotes = false;
    let count = 0;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        count += 1;
      }
    }
    return count;
  }

  private async toEligibilityEnrollmentList(
    records: EligibilityEnrollmentRecord[],
    options: { includePeople: boolean },
  ): Promise<PollEligibilityEnrollmentList> {
    const peopleByEnrollmentNumber = options.includePeople
      ? await this.lookupEventManagerPeople(records.map((record) => record.enrollmentNumber))
      : new Map<string, AccountManagerPerson[]>();

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

  private async lookupEventManagerPeople(enrollmentNumbers: string[]): Promise<Map<string, AccountManagerPerson[]>> {
    const peopleByEnrollmentNumber = new Map<string, AccountManagerPerson[]>();
    if (enrollmentNumbers.length === 0) {
      return peopleByEnrollmentNumber;
    }

    try {
      const people = await this.accountManager.lookupPeopleByEnrollmentNumbers(enrollmentNumbers);
      for (const person of people) {
        const normalizedEnrollmentNumber = normalizeEnrollmentNumber(person.enrollmentNumber);
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

  private async assertEligibilityMutable(pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { id: true, status: true },
    });
    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
    if (poll.status !== DbPollStatus.DRAFT) {
      throw new ForbiddenException('Eligibility lists are frozen after poll publication.');
    }
  }

  private async assertEligibilityMutableWithClient(
    tx: Prisma.TransactionClient,
    pollId: string,
  ): Promise<void> {
    const poll = await tx.poll.findUnique({
      where: { id: pollId },
      select: { id: true, status: true },
    });
    if (!poll) {
      throw new NotFoundException('Poll not found.');
    }
    if (poll.status !== DbPollStatus.DRAFT) {
      throw new ForbiddenException('Eligibility lists are frozen after poll publication.');
    }
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

  private async ensureEnrollmentListVotingAllowed(
    poll: PollEligibilityRecord,
    user: AuthenticatedVoter,
    client: Pick<PrismaService, 'pollEligibilityEnrollment'> | Prisma.TransactionClient,
  ): Promise<void> {
    const enrollmentNumber = readUserEnrollmentNumber(user);
    if (!enrollmentNumber) {
      throw new ForbiddenException('Voting is restricted to users with an enrollment number.');
    }

    const eligibleEnrollment = await client.pollEligibilityEnrollment.findUnique({
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
    if (!hasUnespEmail(user)) {
      throw new ForbiddenException('Voting is restricted to users with an Unesp email.');
    }
  }

  private async ensureComputerScienceStudentVotingAllowed(
    poll: PollEligibilityRecord,
    user: AuthenticatedVoter,
  ): Promise<void> {
    if (!hasUndergraduateUnespRole(user)) {
      throw new ForbiddenException('Voting is restricted to undergraduate Unesp students.');
    }

    const enrollmentNumber = readUserEnrollmentNumber(user);
    if (!hasComputerScienceEnrollmentPattern(enrollmentNumber)) {
      throw new ForbiddenException('Voting is restricted to computer science students.');
    }

    if (
      (await this.shouldRequireVerifiedUnespRole(poll)) &&
      !hasVerifiedUnespRole(user)
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

    return !(await this.featureFlags.isUndergraduateUnespRoleVerificationDisabled());
  }
}
