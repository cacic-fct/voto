import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CacicElectionSlate,
  PollKioskVotingContext,
  PollResponse,
  PollUserResponseState,
} from '@org/voting-contracts';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
} from '../auth/auth.types';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthorizePollKioskVoteDto } from './dto/poll-kiosk.dto';
import { SubmitPollResponseDto } from './dto/poll.dto';
import { PollImagesService } from './poll-images.service';
import { PollKioskAuthorizationService } from './poll-kiosk-authorization.service';
import { PollsService } from './polls.service';

export const POLL_KIOSK_COOKIE_NAME = 'cacic_voto_kiosk_authorization';
export const POLL_KIOSK_REQUEST_HEADER = 'x-cacic-voto-kiosk';
export const POLL_KIOSK_REQUEST_HEADER_VALUE = '1';

type RequestWithCookies = Request & {
  cookies?: Record<string, unknown>;
};

@ApiTags('Admin poll kiosk')
@ApiCookieAuth()
@Controller('admin/polls/:id/kiosk')
@RequirePermissions('poll#kiosk')
export class AdminPollKioskController {
  constructor(
    private readonly authorizations: PollKioskAuthorizationService,
    private readonly polls: PollsService,
    private readonly pollImages: PollImagesService,
  ) {}

  @Post('authorization')
  @ApiOperation({
    summary: 'Authorize one short-lived kiosk ballot through Account Manager TOTP',
  })
  @ApiCreatedResponse({ description: 'Poll-bound kiosk voting context.' })
  async authorize(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers(POLL_KIOSK_REQUEST_HEADER) kioskHeader: string | undefined,
    @Body() body: AuthorizePollKioskVoteDto,
  ): Promise<PollKioskVotingContext> {
    this.assertKioskRequestHeader(kioskHeader);
    const previousToken = this.readCookie(request, POLL_KIOSK_COOKIE_NAME);
    const issued = await this.authorizations.authorize(
      pollId,
      body,
      this.getUser(request),
      this.getSessionId(request),
    );
    try {
      await this.authorizations.discard(previousToken);
    } catch (error) {
      await this.authorizations.discard(issued.token).catch(() => undefined);
      throw error;
    }
    const expiresAt = new Date(issued.context.expiresAt).getTime();
    response.cookie(POLL_KIOSK_COOKIE_NAME, issued.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.isSecureRequest(request),
      expires: new Date(expiresAt),
      maxAge: Math.max(expiresAt - Date.now(), 0),
      path: this.cookiePath(pollId),
    });
    return issued.context;
  }

  @Get('context')
  @ApiOperation({ summary: 'Read the current poll-bound kiosk voting context' })
  @ApiOkResponse({ description: 'Kiosk voter display data and poll definition.' })
  async getContext(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PollKioskVotingContext> {
    try {
      return await this.authorizations.getContext(
        pollId,
        this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
        this.getUser(request),
        this.getSessionId(request),
      );
    } catch (error) {
      this.clearAuthorizationCookie(response, request, pollId);
      throw error;
    }
  }

  @Get('responses/me')
  @ApiOperation({ summary: 'Read response state for the TOTP-authorized kiosk voter' })
  @ApiOkResponse({ description: 'Current response state for the authorized voter.' })
  getResponseState(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollUserResponseState> {
    return this.authorizations.getResponseState(
      pollId,
      this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
      this.getUser(request),
      this.getSessionId(request),
    );
  }

  @Get('cacic-election/slates')
  @ApiOperation({ summary: 'List ballot slates for the TOTP-authorized kiosk voter' })
  @ApiOkResponse({ description: 'Approved election slates.' })
  async listCacicElectionSlates(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CacicElectionSlate[]> {
    const principal = await this.authorizations.readPrincipal(
      pollId,
      this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
      this.getUser(request),
      this.getSessionId(request),
    );
    return this.polls.listPublicCacicElectionSlates(pollId, principal);
  }

  @Get('images/:imageId')
  @ApiOperation({ summary: 'Read a poll image for the TOTP-authorized kiosk voter' })
  @ApiOkResponse({ description: 'AVIF image stream.' })
  async getPollImage(
    @Param('id') pollId: string,
    @Param('imageId') imageId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const principal = await this.authorizations.readPrincipal(
      pollId,
      this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
      this.getUser(request),
      this.getSessionId(request),
    );
    await this.polls.assertPublishedPollReadable(pollId, principal);
    const image = await this.pollImages.getPollImage(pollId, imageId, principal, {
      allowPublishedRead: true,
    });
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    if (image.contentLength !== undefined) {
      response.setHeader('Content-Length', String(image.contentLength));
    }
    await this.pipeImage(image.stream, response, request);
  }

  @Post('responses')
  @ApiOperation({ summary: 'Submit one ballot for the TOTP-authorized kiosk voter' })
  @ApiCreatedResponse({ description: 'Stored poll response.' })
  async submitResponse(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers(POLL_KIOSK_REQUEST_HEADER) kioskHeader: string | undefined,
    @Body() body: SubmitPollResponseDto,
  ): Promise<PollResponse> {
    this.assertKioskRequestHeader(kioskHeader);
    const submitted = await this.authorizations.submitResponse(
      pollId,
      this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
      body,
      this.getUser(request),
      this.getSessionId(request),
    );
    this.clearAuthorizationCookie(response, request, pollId);
    return submitted;
  }

  @Delete('authorization')
  @ApiOperation({ summary: 'Cancel the current kiosk voter authorization' })
  @ApiNoContentResponse({ description: 'Kiosk authorization cleared.' })
  async cancel(
    @Param('id') pollId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers(POLL_KIOSK_REQUEST_HEADER) kioskHeader: string | undefined,
  ): Promise<void> {
    this.assertKioskRequestHeader(kioskHeader);
    await this.authorizations.discard(
      this.readCookie(request, POLL_KIOSK_COOKIE_NAME),
    );
    this.clearAuthorizationCookie(response, request, pollId);
  }

  private assertKioskRequestHeader(value: string | undefined): void {
    if (value !== POLL_KIOSK_REQUEST_HEADER_VALUE) {
      throw new UnauthorizedException('Missing kiosk request proof.');
    }
  }

  private getUser(request: AuthenticatedRequest): AuthenticatedPrincipal {
    if (!request.user) {
      throw new UnauthorizedException('Missing authenticated administrator.');
    }
    return request.user;
  }

  private getSessionId(request: AuthenticatedRequest): string {
    if (!request.sessionId) {
      throw new UnauthorizedException('Missing authenticated session.');
    }
    return request.sessionId;
  }

  private cookiePath(pollId: string): string {
    return `/api/admin/polls/${encodeURIComponent(pollId)}/kiosk`;
  }

  private clearAuthorizationCookie(
    response: Response,
    request: Request,
    pollId: string,
  ): void {
    response.clearCookie(POLL_KIOSK_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.isSecureRequest(request),
      path: this.cookiePath(pollId),
    });
  }

  private readCookie(request: Request, name: string): string | undefined {
    const parsed = (request as RequestWithCookies).cookies?.[name];
    if (typeof parsed === 'string' && parsed) {
      return parsed;
    }

    for (const cookie of request.headers.cookie?.split(';') ?? []) {
      const [cookieName, ...rest] = cookie.trim().split('=');
      if (cookieName === name && rest.length > 0) {
        try {
          return decodeURIComponent(rest.join('='));
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private async pipeImage(
    stream: Readable,
    response: Response,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const abort = () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    };
    const canObserveAbort = typeof request.once === 'function' && typeof request.off === 'function';
    if (canObserveAbort) {
      request.once('aborted', abort);
    }
    try {
      if (typeof response.on !== 'function') {
        return;
      }
      await pipeline(stream, response);
    } catch (error: unknown) {
      if (!request.destroyed && !request.aborted) {
        throw error;
      }
    } finally {
      if (canObserveAbort) {
        request.off('aborted', abort);
      }
    }
  }

  private isSecureRequest(request: Request): boolean {
    if (request.secure) {
      return true;
    }
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    const forwardedProto = request.headers['x-forwarded-proto'];
    return Array.isArray(forwardedProto)
      ? forwardedProto[0] === 'https'
      : forwardedProto === 'https';
  }
}
