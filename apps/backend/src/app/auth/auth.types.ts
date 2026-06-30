import { AuthenticatedUser } from '@org/voting-contracts';
import { Request } from 'express';

export type AuthenticatedPrincipal = AuthenticatedUser & {
  claims: Record<string, unknown>;
  token: string;
  roleSet: Set<string>;
  permissionSet: Set<string>;
};

export type AuthenticatedVoter = AuthenticatedPrincipal & {
  sub: string;
};

export type AuthenticatedRequest = Request & {
  sessionId?: string;
  user?: AuthenticatedPrincipal;
};

export type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  idTokenHint?: string;
  accessTokenExpiresAt: number;
  sessionExpiresAt: number;
};

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

export type TokenClaims = Record<string, unknown>;

export type AuthorizationState = {
  redirectUri?: string;
  returnTo?: string;
  state?: string;
  prompt?: string;
};
