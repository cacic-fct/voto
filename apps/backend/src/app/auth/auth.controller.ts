import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import type { PermissionEvaluationResponse } from '@org/voting-contracts';
import {
  getAuthStateCookieName,
  getAuthStateCookiePath,
  getAuthSessionCookieName,
} from './auth.constants';
import { Public } from './decorators/public.decorator';
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
  AuthorizationState,
} from './auth.types';
import { KeycloakAuthService } from './keycloak-auth.service';

type RequestWithCookies = Request & {
  cookies?: Record<string, unknown>;
};

const CACIC_TRACKING_COOKIE_NAMES = [
  'cacic-analytics-id',
  'cacic-analytics-consent',
  'cacic-purr',
  'cacic-purr-quick',
] as const;

class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Optional post-logout redirect URI. Must use an allowed origin.',
    example: 'http://localhost:4200/login',
  })
  @IsOptional()
  @IsString()
  postLogoutRedirectUri?: string;
}

class PermissionEvaluationRequestDto {
  @ApiProperty({
    description:
      'Permission identifiers to evaluate against the current session.',
    example: ['poll#read', 'poll#create'],
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  permissions!: string[];
}

class LoginUrlResponseDto {
  @ApiProperty({
    description: 'Keycloak authorization URL.',
    example:
      'https://sso.cacic.com.br/realms/cacic-sso/protocol/openid-connect/auth?...',
  })
  authorizationUrl!: string;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly allowedCallbackRedirectOrigins =
    this.readAllowedCallbackRedirectOrigins();
  private readonly allowedPostLoginRedirectOrigins =
    this.readAllowedPostLoginRedirectOrigins();
  private readonly allowedPostLogoutRedirectOrigins =
    this.readAllowedPostLogoutRedirectOrigins();

  constructor(private readonly auth: KeycloakAuthService) {}

  @Get('login')
  @Public()
  @ApiOperation({ summary: 'Build a Keycloak login URL' })
  @ApiOkResponse({ type: LoginUrlResponseDto })
  async getLoginUrl(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('returnTo') returnTo?: string,
    @Query('scope') scope?: string,
    @Query('prompt') prompt?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authorization = await this.auth.buildAuthorizationUrl({
      redirectUri: this.resolveCallbackRedirectUri(request),
      returnTo: this.resolveReturnTo(returnTo),
      scope,
      prompt,
    });

    this.setAuthorizationStateCookie(response, request, authorization.state);
    return { authorizationUrl: authorization.authorizationUrl };
  }

  @Get('login/redirect')
  @Public()
  @ApiOperation({ summary: 'Redirect the browser to Keycloak' })
  @ApiResponse({ status: 302, description: 'Browser redirected to Keycloak.' })
  async redirectToLogin(
    @Req() request: Request,
    @Res() response: Response,
    @Query('returnTo') returnTo?: string,
    @Query('scope') scope?: string,
    @Query('prompt') prompt?: string,
  ): Promise<void> {
    const authorization = await this.auth.buildAuthorizationUrl({
      redirectUri: this.resolveCallbackRedirectUri(request),
      returnTo: this.resolveReturnTo(returnTo),
      scope,
      prompt,
    });

    this.setAuthorizationStateCookie(response, request, authorization.state);
    response.redirect(authorization.authorizationUrl);
  }

  @Get('callback')
  @Public()
  @ApiOperation({
    summary: 'Complete the Keycloak authorization-code callback',
  })
  @ApiResponse({
    status: 302,
    description: 'Session cookie set and browser redirected back to the app.',
  })
  @ApiBadRequestResponse({
    description: 'Returned when the authorization state or code is invalid.',
  })
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('error') error?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    this.assertSecureRequest(request);
    const authorizationState = await this.consumeAuthorizationState(
      request,
      response,
      state,
    );
    if (error) {
      response.redirect(
        this.getFailedAuthorizationRedirectUri(authorizationState),
      );
      return;
    }

    if (!code) {
      throw new BadRequestException('Missing authorization code.');
    }

    const tokenResponse = await this.auth.exchangeCodeForTokens(
      code,
      authorizationState,
      this.resolveCallbackRedirectUri(request),
    );
    const session = await this.auth.createSession(tokenResponse);

    this.assertSecureRequest(request);
    response.cookie(getAuthSessionCookieName(), session.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      expires: new Date(session.sessionExpiresAt),
      maxAge: this.resolveCookieMaxAge(session.sessionExpiresAt),
      path: '/',
    });

    response.redirect(this.auth.getPostLoginRedirectUri(authorizationState));
  }

  @Get('me')
  @Public()
  @ApiCookieAuth(getAuthSessionCookieName())
  @ApiOperation({
    summary: 'Read the authenticated identity for the current session',
  })
  getMe(
    @Req() request: AuthenticatedRequest,
  ): ReturnType<AuthController['toPublicUser']> | null {
    return request.user ? this.toPublicUser(request.user) : null;
  }

  @Post('refresh')
  @Public()
  @ApiCookieAuth(getAuthSessionCookieName())
  @ApiOperation({ summary: 'Refresh the current session' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const sessionId = this.readCookie(request, getAuthSessionCookieName());
    if (!sessionId) {
      throw new ForbiddenException('Missing session.');
    }

    const result = await this.auth.refreshSession(sessionId);

    this.assertSecureRequest(request);
    response.cookie(getAuthSessionCookieName(), sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      expires: new Date(result.sessionExpiresAt),
      maxAge: this.resolveCookieMaxAge(result.sessionExpiresAt),
      path: '/',
    });

    return result;
  }

  @Post('logout')
  @Public()
  @ApiCookieAuth(getAuthSessionCookieName())
  @ApiOperation({
    summary: 'Clear the local session and return a Keycloak logout URL',
  })
  @ApiBody({ type: LogoutDto, required: false })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body?: LogoutDto,
  ) {
    this.assertSecureRequest(request);
    const sessionId = this.readCookie(request, getAuthSessionCookieName());
    const sessionLogoutInput = sessionId
      ? await this.auth.getSessionLogoutInput(sessionId)
      : null;

    if (sessionId) {
      await this.auth.clearSession(sessionId);
    }

    response.clearCookie(getAuthSessionCookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      path: '/',
    });
    this.clearCacicTrackingCookies(response, request);

    return this.auth.logout({
      refreshToken: sessionLogoutInput?.refreshToken,
      idTokenHint: sessionLogoutInput?.idTokenHint,
      postLogoutRedirectUri: this.resolvePostLogoutRedirectUri(
        body?.postLogoutRedirectUri,
      ),
    });
  }

  @Post('permissions/evaluate')
  @ApiCookieAuth(getAuthSessionCookieName())
  @ApiOperation({ summary: 'Evaluate permissions for the current session' })
  async evaluatePermissions(
    @Req() request: AuthenticatedRequest,
    @Body() body: PermissionEvaluationRequestDto,
  ): Promise<PermissionEvaluationResponse> {
    if (!request.sessionId) {
      throw new ForbiddenException('Missing session.');
    }

    const permissions = await this.auth.evaluateSessionPermissions(
      request.sessionId,
      body.permissions,
    );
    return { permissions };
  }

  private toPublicUser(user: AuthenticatedPrincipal) {
    return {
      sub: user.sub,
      preferredUsername: user.preferredUsername,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      scopes: user.scopes,
      oidcScopes: user.oidcScopes,
    };
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

      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        this.logger.warn(`Ignoring malformed ${name} cookie.`);
        return null;
      }
    }

    return null;
  }

  private async consumeAuthorizationState(
    request: Request,
    response: Response,
    state?: string,
  ): Promise<AuthorizationState | undefined> {
    const cookieState = this.readCookie(request, getAuthStateCookieName());
    this.clearAuthorizationStateCookie(response, request);

    if (!state || !cookieState || state !== cookieState) {
      throw new BadRequestException('Invalid authorization state.');
    }

    const authorizationState = await this.auth.consumeAuthorizationState(state);
    if (!authorizationState) {
      throw new BadRequestException('Invalid authorization state.');
    }

    return authorizationState;
  }

  private setAuthorizationStateCookie(
    response: Response,
    request: Request,
    state: string,
  ): void {
    this.assertSecureRequest(request);
    response.cookie(getAuthStateCookieName(), state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      maxAge: 10 * 60 * 1000,
      path: getAuthStateCookiePath(),
    });
  }

  private clearAuthorizationStateCookie(
    response: Response,
    request: Request,
  ): void {
    response.clearCookie(getAuthStateCookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      path: getAuthStateCookiePath(),
    });
  }

  private getCallbackRedirectUri(request: Request): string {
    const canonicalOrigin = this.readCanonicalOrigin();
    const forwardedProtocol = this.isProduction() ? undefined : this.readForwardedHeader(request, 'x-forwarded-proto');
    const forwardedHost = this.isProduction() ? undefined : this.readForwardedHeader(request, 'x-forwarded-host');
    const origin = canonicalOrigin ?? `${forwardedProtocol ?? request.protocol}://${forwardedHost ?? request.get('host')}`;
    return new URL('/api/auth/callback', origin).toString();
  }

  private resolveCallbackRedirectUri(request: Request): string {
    const redirectUri =
      process.env.KEYCLOAK_REDIRECT_URI?.trim() ||
      this.getCallbackRedirectUri(request);
    const url = this.parseHttpUrl(
      redirectUri,
      'Invalid callback redirect URI.',
    );

    if (url.pathname !== '/api/auth/callback') {
      throw new BadRequestException(
        'Callback redirect URI path is not allowed.',
      );
    }

    if (!this.allowedCallbackRedirectOrigins.has(url.origin)) {
      throw new BadRequestException(
        'Callback redirect URI origin is not allowed.',
      );
    }
    const canonicalOrigin = this.readCanonicalOrigin();
    if (this.isProduction() && canonicalOrigin && url.origin !== canonicalOrigin) {
      throw new BadRequestException('Callback redirect URI must use the canonical origin.');
    }

    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  private resolveReturnTo(returnTo?: string): string | undefined {
    const redirectUri = returnTo?.trim();
    if (!redirectUri) {
      return undefined;
    }

    if (redirectUri.startsWith('/') && !redirectUri.startsWith('//')) {
      return redirectUri;
    }

    const url = this.parseHttpUrl(
      redirectUri,
      'Invalid post-login redirect URI.',
    );
    if (!this.allowedPostLoginRedirectOrigins.has(url.origin)) {
      throw new BadRequestException(
        'Post-login redirect URI origin is not allowed.',
      );
    }

    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  }

  private resolvePostLogoutRedirectUri(
    requestedRedirectUri?: string,
  ): string | undefined {
    const redirectUri = requestedRedirectUri?.trim();
    if (!redirectUri) {
      return undefined;
    }

    const url = this.parseHttpUrl(
      redirectUri,
      'Invalid post-logout redirect URI.',
    );
    if (!this.allowedPostLogoutRedirectOrigins.has(url.origin)) {
      throw new BadRequestException(
        'Post-logout redirect URI origin is not allowed.',
      );
    }

    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  }

  private parseHttpUrl(value: string, errorMessage: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException(errorMessage);
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException(errorMessage);
    }

    return url;
  }

  private readAllowedCallbackRedirectOrigins(): Set<string> {
    return this.readAllowedOrigins(
      'KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS',
      this.isProduction()
        ? ['https://voto.cacic.com.br']
        : ['http://localhost:3000', 'http://localhost:4200', 'https://voto.cacic.com.br'],
    );
  }

  private readAllowedPostLoginRedirectOrigins(): Set<string> {
    return this.readAllowedOrigins(
      'KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS',
      this.isProduction() ? ['https://voto.cacic.com.br'] : ['http://localhost:4200', 'https://voto.cacic.com.br'],
    );
  }

  private readAllowedPostLogoutRedirectOrigins(): Set<string> {
    return this.readAllowedOrigins(
      'KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS',
      this.isProduction() ? ['https://voto.cacic.com.br'] : ['http://localhost:4200', 'https://voto.cacic.com.br'],
    );
  }

  private readAllowedOrigins(envName: string, defaults: string[]): Set<string> {
    const origins = new Set(defaults);
    for (const rawOrigin of (process.env[envName] ?? '').split(',')) {
      const value = rawOrigin.trim();
      if (!value) {
        continue;
      }

      try {
        origins.add(new URL(value).origin);
      } catch {
        this.logger.warn(`Ignoring invalid ${envName} value: ${value}`);
      }
    }

    return origins;
  }

  private getFailedAuthorizationRedirectUri(
    authorizationState?: AuthorizationState,
  ): string {
    const redirectUri = this.auth.getPostLoginRedirectUri(authorizationState);
    if (authorizationState?.prompt !== 'none') {
      return redirectUri;
    }

    try {
      const isRelativePath =
        redirectUri.startsWith('/') && !redirectUri.startsWith('//');
      const url = new URL(redirectUri, 'https://voto.cacic.local');
      url.searchParams.set('sso', 'none');
      return isRelativePath
        ? `${url.pathname}${url.search}${url.hash}`
        : url.toString();
    } catch {
      return redirectUri;
    }
  }

  private resolveCookieMaxAge(expiresAt: number): number {
    return Math.max(expiresAt - Date.now(), 0);
  }

  private clearCacicTrackingCookies(
    response: Response,
    request: Request,
  ): void {
    const secure = this.isSecureRequest(request);

    for (const cookieName of CACIC_TRACKING_COOKIE_NAMES) {
      response.clearCookie(cookieName, {
        domain: '.cacic.com.br',
        sameSite: 'lax',
        secure,
        path: '/',
      });
      response.clearCookie(cookieName, {
        sameSite: 'lax',
        secure,
        path: '/',
      });
    }
  }

  private isSecureRequest(request: Request): boolean {
    if (request.secure === true) {
      return true;
    }
    if (this.isProduction()) {
      return false;
    }
    const forwardedProto = this.readForwardedHeader(request, 'x-forwarded-proto');
    return forwardedProto === 'https';
  }

  private readForwardedHeader(request: Request, headerName: string): string | undefined {
    const value = request.headers[headerName];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  }

  private assertSecureRequest(request: Request): void {
    if (process.env.NODE_ENV === 'production' && !this.isSecureRequest(request)) {
      throw new BadRequestException('HTTPS is required for authentication cookies.');
    }
  }

  private readCanonicalOrigin(): string | undefined {
    const rawOrigin = process.env.PUBLIC_ORIGIN?.trim() ?? process.env.KEYCLOAK_CANONICAL_ORIGIN?.trim();
    if (!rawOrigin) {
      return undefined;
    }

    try {
      const url = new URL(rawOrigin);
      if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
        return undefined;
      }
      return url.origin;
    } catch {
      this.logger.warn('Ignoring invalid PUBLIC_ORIGIN/KEYCLOAK_CANONICAL_ORIGIN value.');
      return undefined;
    }
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
}
