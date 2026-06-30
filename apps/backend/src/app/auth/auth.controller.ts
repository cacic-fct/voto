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
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Request, Response } from 'express';
import { PermissionEvaluationResponse } from '@org/voting-contracts';
import { AUTH_SESSION_COOKIE_NAME, AUTH_STATE_COOKIE_NAME } from './auth.constants';
import { Public } from './decorators/public.decorator';
import { AuthenticatedPrincipal, AuthenticatedRequest, AuthorizationState } from './auth.types';
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
    description: 'Optional post-logout redirect URI. Must use an allowed origin.',
    example: 'http://localhost:4200/login',
  })
  @IsOptional()
  @IsString()
  postLogoutRedirectUri?: string;
}

class PermissionEvaluationRequestDto {
  @ApiProperty({
    description: 'Permission identifiers to evaluate against the current session.',
    example: ['poll#read', 'poll#create'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

class LoginUrlResponseDto {
  @ApiProperty({
    description: 'Keycloak authorization URL.',
    example: 'https://sso.cacic.dev.br/realms/cacic-sso/protocol/openid-connect/auth?...',
  })
  authorizationUrl!: string;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly allowedCallbackRedirectOrigins = this.readAllowedCallbackRedirectOrigins();
  private readonly allowedPostLoginRedirectOrigins = this.readAllowedPostLoginRedirectOrigins();
  private readonly allowedPostLogoutRedirectOrigins = this.readAllowedPostLogoutRedirectOrigins();

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
  @ApiOperation({ summary: 'Complete the Keycloak authorization-code callback' })
  @ApiResponse({ status: 302, description: 'Session cookie set and browser redirected back to the app.' })
  @ApiBadRequestResponse({ description: 'Returned when the authorization state or code is invalid.' })
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('error') error?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    const authorizationState = await this.consumeAuthorizationState(request, response, state);
    if (error) {
      response.redirect(this.getFailedAuthorizationRedirectUri(authorizationState));
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

    response.cookie(AUTH_SESSION_COOKIE_NAME, session.sessionId, {
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
  @ApiCookieAuth(AUTH_SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Read the authenticated identity for the current session' })
  getMe(@Req() request: AuthenticatedRequest): ReturnType<AuthController['toPublicUser']> | null {
    return request.user ? this.toPublicUser(request.user) : null;
  }

  @Post('refresh')
  @Public()
  @ApiCookieAuth(AUTH_SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Refresh the current session' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const sessionId = this.readCookie(request, AUTH_SESSION_COOKIE_NAME);
    if (!sessionId) {
      throw new ForbiddenException('Missing session.');
    }

    const result = await this.auth.refreshSession(sessionId);

    response.cookie(AUTH_SESSION_COOKIE_NAME, sessionId, {
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
  @ApiCookieAuth(AUTH_SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Clear the local session and return a Keycloak logout URL' })
  @ApiBody({ type: LogoutDto, required: false })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body?: LogoutDto) {
    const sessionId = this.readCookie(request, AUTH_SESSION_COOKIE_NAME);
    const sessionLogoutInput = sessionId ? await this.auth.getSessionLogoutInput(sessionId) : null;

    if (sessionId) {
      await this.auth.clearSession(sessionId);
    }

    response.clearCookie(AUTH_SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      path: '/',
    });
    this.clearCacicTrackingCookies(response, request);

    return this.auth.logout({
      refreshToken: sessionLogoutInput?.refreshToken,
      idTokenHint: sessionLogoutInput?.idTokenHint,
      postLogoutRedirectUri: this.resolvePostLogoutRedirectUri(body?.postLogoutRedirectUri),
    });
  }

  @Post('permissions/evaluate')
  @ApiCookieAuth(AUTH_SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Evaluate permissions for the current session' })
  async evaluatePermissions(
    @Req() request: AuthenticatedRequest,
    @Body() body: PermissionEvaluationRequestDto,
  ): Promise<PermissionEvaluationResponse> {
    if (!request.sessionId) {
      throw new ForbiddenException('Missing session.');
    }

    const permissions = await this.auth.evaluateSessionPermissions(request.sessionId, body.permissions);
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

      return decodeURIComponent(rest.join('='));
    }

    return null;
  }

  private async consumeAuthorizationState(
    request: Request,
    response: Response,
    state?: string,
  ): Promise<AuthorizationState | undefined> {
    const cookieState = this.readCookie(request, AUTH_STATE_COOKIE_NAME);
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

  private setAuthorizationStateCookie(response: Response, request: Request, state: string): void {
    response.cookie(AUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      maxAge: 10 * 60 * 1000,
      path: '/api/auth/callback',
    });
  }

  private clearAuthorizationStateCookie(response: Response, request: Request): void {
    response.clearCookie(AUTH_STATE_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(request),
      path: '/api/auth/callback',
    });
  }

  private getCallbackRedirectUri(request: Request): string {
    const protocol = this.readForwardedHeader(request, 'x-forwarded-proto')?.split(',')[0]?.trim();
    const host = this.readForwardedHeader(request, 'x-forwarded-host')?.split(',')[0]?.trim();
    const origin = `${protocol || request.protocol}://${host || request.get('host')}`;
    return new URL('/api/auth/callback', origin).toString();
  }

  private resolveCallbackRedirectUri(request: Request): string {
    const redirectUri = process.env.KEYCLOAK_REDIRECT_URI?.trim() || this.getCallbackRedirectUri(request);
    const url = this.parseHttpUrl(redirectUri, 'Invalid callback redirect URI.');

    if (url.pathname !== '/api/auth/callback') {
      throw new BadRequestException('Callback redirect URI path is not allowed.');
    }

    if (!this.allowedCallbackRedirectOrigins.has(url.origin)) {
      throw new BadRequestException('Callback redirect URI origin is not allowed.');
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

    const url = this.parseHttpUrl(redirectUri, 'Invalid post-login redirect URI.');
    if (!this.allowedPostLoginRedirectOrigins.has(url.origin)) {
      throw new BadRequestException('Post-login redirect URI origin is not allowed.');
    }

    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  }

  private resolvePostLogoutRedirectUri(requestedRedirectUri?: string): string | undefined {
    const redirectUri = requestedRedirectUri?.trim();
    if (!redirectUri) {
      return undefined;
    }

    const url = this.parseHttpUrl(redirectUri, 'Invalid post-logout redirect URI.');
    if (!this.allowedPostLogoutRedirectOrigins.has(url.origin)) {
      throw new BadRequestException('Post-logout redirect URI origin is not allowed.');
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
    return this.readAllowedOrigins('KEYCLOAK_ALLOWED_CALLBACK_REDIRECT_ORIGINS', [
      'http://localhost:3000',
      'http://localhost:4200',
      'https://voto.cacic.dev.br',
    ]);
  }

  private readAllowedPostLoginRedirectOrigins(): Set<string> {
    return this.readAllowedOrigins('KEYCLOAK_ALLOWED_POST_LOGIN_REDIRECT_ORIGINS', [
      'http://localhost:4200',
      'https://voto.cacic.dev.br',
    ]);
  }

  private readAllowedPostLogoutRedirectOrigins(): Set<string> {
    return this.readAllowedOrigins('KEYCLOAK_ALLOWED_POST_LOGOUT_REDIRECT_ORIGINS', [
      'http://localhost:4200',
      'https://voto.cacic.dev.br',
    ]);
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

  private readForwardedHeader(request: Request, headerName: string): string | undefined {
    const value = request.headers[headerName];
    return Array.isArray(value) ? value[0] : value;
  }

  private getFailedAuthorizationRedirectUri(authorizationState?: AuthorizationState): string {
    const redirectUri = this.auth.getPostLoginRedirectUri(authorizationState);
    if (authorizationState?.prompt !== 'none') {
      return redirectUri;
    }

    try {
      const isRelativePath = redirectUri.startsWith('/') && !redirectUri.startsWith('//');
      const url = new URL(redirectUri, 'https://voto.cacic.local');
      url.searchParams.set('sso', 'none');
      return isRelativePath ? `${url.pathname}${url.search}${url.hash}` : url.toString();
    } catch {
      return redirectUri;
    }
  }

  private resolveCookieMaxAge(expiresAt: number): number {
    return Math.max(expiresAt - Date.now(), 0);
  }

  private clearCacicTrackingCookies(response: Response, request: Request): void {
    const secure = this.isSecureRequest(request);

    for (const cookieName of CACIC_TRACKING_COOKIE_NAMES) {
      response.clearCookie(cookieName, {
        domain: '.cacic.dev.br',
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
    if (request.secure) {
      return true;
    }

    const forwardedProto = request.headers['x-forwarded-proto'];
    if (Array.isArray(forwardedProto)) {
      return forwardedProto[0] === 'https';
    }

    return forwardedProto === 'https';
  }
}
