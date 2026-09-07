import { UnauthorizedException } from '@nestjs/common';
import { AuthenticatedPrincipal, AuthenticatedVoter } from '../auth/auth.types';

export function requireAuthenticatedVoter(user?: AuthenticatedPrincipal): AuthenticatedVoter {
  if (!user?.sub) {
    throw new UnauthorizedException('Authentication is required for voting.');
  }

  return user as AuthenticatedVoter;
}

export function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Prisma's serializable transactions report retryable write conflicts as P2034. */
export function isSerializationConflictError(error: unknown): error is { code: 'P2034' } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  );
}

/** Prisma reports an interactive transaction that exceeded its timeout as P2028. */
export function isTransactionTimeoutError(error: unknown): error is { code: 'P2028' } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2028'
  );
}
