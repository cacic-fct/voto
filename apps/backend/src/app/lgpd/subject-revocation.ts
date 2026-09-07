import { createHmac } from 'node:crypto';

/** Stable across deletion requests; never persist the original subject in the revocation ledger. */
export function revokedSubjectHash(userId: string): string {
  const secret = process.env.LGPD_ANONYMIZATION_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('LGPD_ANONYMIZATION_SECRET is required in production.');
  }
  return createHmac('sha256', secret || 'local-development-lgpd-anonymization-secret')
    .update(`voto:revoked-subject:v1\0${userId}`)
    .digest('hex');
}
