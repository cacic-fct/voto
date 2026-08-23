import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const POLL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ELEMENT_NAMESPACE_PREFIX = '_cacic_element_';
const OPTION_NAMESPACE_PREFIX = '_cacic_option_';

function encodeIdentifier(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeIdentifier(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function createUuidV7(): string {
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

export function normalizeDirectLinkToken(rawValue: unknown): string {
  const token = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if (!UUID_V7_PATTERN.test(token)) {
    throw new NotFoundException('Poll not found.');
  }

  return token;
}

/** Client supplied element, option, grid, and scheduling identifiers are opaque keys. */
export function normalizePollIdentifier(rawValue: unknown, label = 'Identifier'): string {
  const identifier = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!POLL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new BadRequestException(`${label} must be a nonblank canonical identifier.`);
  }

  return identifier;
}

export function namespacedPollElementId(pollId: string, externalId: string): string {
  return `${ELEMENT_NAMESPACE_PREFIX}${encodeIdentifier(pollId)}.${encodeIdentifier(externalId)}`;
}

export function namespacedPollOptionId(elementId: string, externalId: string): string {
  return `${OPTION_NAMESPACE_PREFIX}${encodeIdentifier(elementId)}.${encodeIdentifier(externalId)}`;
}

export function externalPollElementId(pollId: string, storedId: string): string {
  if (!storedId.startsWith(ELEMENT_NAMESPACE_PREFIX)) return storedId;
  const encoded = storedId.slice(ELEMENT_NAMESPACE_PREFIX.length);
  const separator = encoded.indexOf('.');
  if (separator < 0) return storedId;
  const encodedPollId = encoded.slice(0, separator);
  const encodedExternalId = encoded.slice(separator + 1);
  if (decodeIdentifier(encodedPollId ?? '') !== pollId) return storedId;
  return decodeIdentifier(encodedExternalId ?? '') ?? storedId;
}

export function externalPollOptionId(elementId: string, storedId: string): string {
  if (!storedId.startsWith(OPTION_NAMESPACE_PREFIX)) return storedId;
  const encoded = storedId.slice(OPTION_NAMESPACE_PREFIX.length);
  const separator = encoded.indexOf('.');
  if (separator < 0) return storedId;
  const encodedElementId = encoded.slice(0, separator);
  const encodedExternalId = encoded.slice(separator + 1);
  if (decodeIdentifier(encodedElementId ?? '') !== elementId) return storedId;
  return decodeIdentifier(encodedExternalId ?? '') ?? storedId;
}

export function assertDeterministicIdentifierAvailable(
  existing: { id: string; parentId: string } | null,
  expectedParentId: string,
  identifier: string,
): void {
  if (existing && existing.parentId !== expectedParentId) {
    throw new ConflictException(`The ${identifier} is already associated with another poll definition.`);
  }
}
