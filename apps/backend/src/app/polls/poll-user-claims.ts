import { PollResultsVoter } from '@org/voting-contracts';
import { Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/auth.types';

const MAX_ENROLLMENT_NUMBER_LENGTH = 64;
const UNESP_EMAIL_DOMAIN = '@unesp.br';
const COMPUTER_SCIENCE_COURSE_CODE = '12';
const UNDERGRADUATE_UNESP_ROLE = 'aluno-graduacao';

export function normalizeEnrollmentNumber(rawValue: unknown): string | null {
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

export function hasNonEmptyRawValue(rawValue: unknown): boolean {
  return typeof rawValue === 'string'
    ? rawValue.trim().length > 0
    : typeof rawValue === 'number' && Number.isFinite(rawValue);
}

export function readUserEnrollmentNumber(user: AuthenticatedPrincipal): string | null {
  return readEnrollmentNumberFromClaims(user.claims);
}

export function readEnrollmentNumberFromClaims(claims: Record<string, unknown>): string | null {
  for (const value of readClaimValuesFromClaims(claims, [
    'enrollmentNumber',
    'enrollment_number',
    'academicId',
    'academic_id',
  ])) {
    const enrollmentNumber = normalizeEnrollmentNumber(value);
    if (enrollmentNumber) {
      return enrollmentNumber;
    }
  }

  return null;
}

export function hasUnespEmail(user: AuthenticatedPrincipal): boolean {
  return readUserEmails(user).some((email) => email.endsWith(UNESP_EMAIL_DOMAIN));
}

export function readUserEmails(user: AuthenticatedPrincipal): string[] {
  const emails = [user.email, ...readClaimValues(user, ['email', 'secondary_emails', 'secondaryEmails'])]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((email) => parseStringList(email))
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(emails)];
}

export function hasUndergraduateUnespRole(user: AuthenticatedPrincipal): boolean {
  return readClaimValues(user, ['unesp_role', 'unespRole'])
    .filter((value): value is string => typeof value === 'string')
    .some((role) => role.trim() === UNDERGRADUATE_UNESP_ROLE);
}

export function hasComputerScienceEnrollmentPattern(enrollmentNumber: string | null): boolean {
  const normalizedEnrollmentNumber = enrollmentNumber?.replace(/\D/g, '');
  if (!normalizedEnrollmentNumber || normalizedEnrollmentNumber.length < 4) {
    return false;
  }

  return normalizedEnrollmentNumber.substring(2, 4) === COMPUTER_SCIENCE_COURSE_CODE;
}

export function hasVerifiedUnespRole(user: AuthenticatedPrincipal): boolean {
  return readClaimValues(user, [
    'unespRoleVerified',
    'isUnespRoleVerified',
    'unesp_role_verified',
    'is_unesp_role_verified',
  ]).some((value) => readBooleanValue(value));
}

export function readClaimValues(user: AuthenticatedPrincipal, claimNames: readonly string[]): unknown[] {
  return readClaimValuesFromClaims(user.claims, claimNames);
}

export function readClaimValuesFromClaims(claims: Record<string, unknown>, claimNames: readonly string[]): unknown[] {
  const values: unknown[] = [];
  const attributes = isRecord(claims['attributes']) ? (claims['attributes'] as Record<string, unknown>) : undefined;

  for (const claimName of claimNames) {
    values.push(...flattenClaimValue(claims[claimName]));
    if (attributes) {
      values.push(...flattenClaimValue(attributes[claimName]));
    }
  }

  return values;
}

export function flattenClaimValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenClaimValue(item));
  }

  if (typeof value !== 'string') {
    return value === undefined ? [] : [value];
  }

  return parseStringList(value);
}

export function parseStringList(value: string): string[] {
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

export function readBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function toPollResultsVoter(user: {
  id: string;
  name: string | null;
  preferredUsername: string | null;
  email: string | null;
  claims: Prisma.JsonValue | null;
}): PollResultsVoter {
  const claims = isRecord(user.claims) ? user.claims : {};
  const enrollmentNumber = readEnrollmentNumberFromClaims(claims);
  const unespRoles = readClaimValuesFromClaims(claims, ['unesp_role', 'unespRole'])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    userId: user.id,
    name: user.name ?? readStringClaimFromClaims(claims, 'name'),
    preferredUsername: user.preferredUsername ?? readStringClaimFromClaims(claims, 'preferred_username'),
    email: user.email ?? readStringClaimFromClaims(claims, 'email'),
    ...(unespRoles.length > 0 ? { unespRole: [...new Set(unespRoles)].join(', ') } : {}),
    ...(enrollmentNumber ? { enrollmentNumber } : {}),
  };
}

export function readStringClaimFromClaims(claims: Record<string, unknown>, claimName: string): string | undefined {
  const value = claims[claimName];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
