import { NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
