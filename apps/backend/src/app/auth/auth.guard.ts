import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME, IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from './auth.constants';
import { AuthenticatedRequest } from './auth.types';
import { KeycloakAuthService } from './keycloak-auth.service';

type RequestWithCookies = Request & {
  cookies?: Record<string, unknown>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: KeycloakAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = this.readCookie(request, AUTH_SESSION_COOKIE_NAME);

    if (!sessionId) {
      if (isPublic) {
        return true;
      }

      throw new UnauthorizedException('Missing authenticated session.');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];

    try {
      request.sessionId = sessionId;
      request.user = await this.auth.authenticateSession(sessionId, requiredPermissions);
      return true;
    } catch (error) {
      if (isPublic) {
        return true;
      }

      throw error;
    }
  }

  private readCookie(request: Request, name: string): string | null {
    const parsedCookie = (request as RequestWithCookies).cookies?.[name];
    if (typeof parsedCookie === 'string') {
      return parsedCookie;
    }

    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [cookieName, ...rest] = cookie.trim().split('=');
      if (cookieName !== name || rest.length === 0) {
        continue;
      }

      return decodeURIComponent(rest.join('='));
    }

    return null;
  }
}
