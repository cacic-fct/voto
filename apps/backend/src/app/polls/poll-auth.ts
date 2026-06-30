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
