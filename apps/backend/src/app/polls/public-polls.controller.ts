import { Body, Controller, Get, MessageEvent, Param, Post, Query, Req, Res, Sse } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Poll, PollResponse, PollResults, PollSummary, PollUserResponseState } from '@org/voting-contracts';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { AuthenticatedRequest } from '../auth/auth.types';
import { SubmitPollResponseDto } from './dto/poll.dto';
import { PollImagesService } from './poll-images.service';
import { PollsService } from './polls.service';

@ApiTags('Public polls')
@ApiCookieAuth()
@Controller('polls')
export class PublicPollsController {
  constructor(
    private readonly polls: PollsService,
    private readonly pollImages?: PollImagesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List published polls' })
  @ApiOkResponse({ description: 'Published poll summaries.' })
  listPolls(): Promise<PollSummary[]> {
    return this.polls.listPublicPolls();
  }

  @Get('direct/:directLinkToken')
  @ApiOperation({ summary: 'Read a published poll through a direct voting link' })
  @ApiOkResponse({ description: 'Published poll definition for a direct link.' })
  getPollByDirectLink(
    @Param('directLinkToken') directLinkToken: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Poll> {
    return this.polls.getPublishedPollByDirectLink(directLinkToken, request.user);
  }

  @Get('direct/:directLinkToken/images/:imageId')
  @ApiOperation({ summary: 'Read a direct-link poll image' })
  @ApiOkResponse({ description: 'AVIF image stream.' })
  async getDirectLinkPollImage(
    @Param('directLinkToken') directLinkToken: string,
    @Param('imageId') imageId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const pollId = await this.polls.assertPublishedDirectLinkPollReadable(directLinkToken, request.user);
    const image = await this.getPollImages().getPollImage(pollId, imageId, request.user, {
      allowPublishedRead: true,
    });
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    if (image.contentLength !== undefined) {
      response.setHeader('Content-Length', String(image.contentLength));
    }
    image.stream.pipe(response);
  }

  @Get('direct/:directLinkToken/results')
  @ApiOperation({ summary: 'Read public poll results through a direct voting link when enabled' })
  @ApiOkResponse({ description: 'Public poll results without voter identity data.' })
  getDirectLinkPollResults(
    @Param('directLinkToken') directLinkToken: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollResults> {
    return this.polls.getDirectLinkPublicPollResults(directLinkToken, request.user);
  }

  @Get('direct/:directLinkToken/responses/me')
  @ApiOperation({ summary: 'Read the current voter response state through a direct voting link' })
  @ApiOkResponse({ description: 'Current voter response state and editable response when available.' })
  getMyDirectLinkResponse(
    @Param('directLinkToken') directLinkToken: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollUserResponseState> {
    return this.polls.getDirectLinkUserResponseState(directLinkToken, request.user);
  }

  @Sse('direct/:directLinkToken/results/events')
  @ApiOperation({ summary: 'Stream public poll result updates through a direct voting link when enabled' })
  streamDirectLinkPollResults(
    @Param('directLinkToken') directLinkToken: string,
    @Req() request: AuthenticatedRequest,
    @Query('after') after?: string,
  ): Observable<MessageEvent> {
    return this.polls.streamDirectLinkPublicPollResults(
      directLinkToken,
      this.parseResultCursor(after),
      request.user,
    );
  }

  @Post('direct/:directLinkToken/responses')
  @ApiOperation({ summary: 'Submit a response through a direct voting link' })
  @ApiCreatedResponse({ description: 'Stored poll response.' })
  submitDirectLinkResponse(
    @Param('directLinkToken') directLinkToken: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: SubmitPollResponseDto,
  ): Promise<PollResponse> {
    return this.polls.submitDirectLinkResponse(directLinkToken, body, request.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a published poll' })
  @ApiOkResponse({ description: 'Published poll definition.' })
  getPoll(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Poll> {
    return this.polls.getPublishedPoll(id, request.user);
  }

  @Get(':id/images/:imageId')
  @ApiOperation({ summary: 'Read a poll image' })
  @ApiOkResponse({ description: 'AVIF image stream.' })
  async getPollImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.polls.assertPublishedPollReadable(id, request.user);
    const image = await this.getPollImages().getPollImage(id, imageId, request.user, {
      allowPublishedRead: true,
    });
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    if (image.contentLength !== undefined) {
      response.setHeader('Content-Length', String(image.contentLength));
    }
    image.stream.pipe(response);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Read public poll results when enabled' })
  @ApiOkResponse({ description: 'Public poll results without voter identity data.' })
  getPollResults(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollResults> {
    return this.polls.getPublicPollResults(id, request.user);
  }

  @Get(':id/responses/me')
  @ApiOperation({ summary: 'Read the current voter response state for a poll' })
  @ApiOkResponse({ description: 'Current voter response state and editable response when available.' })
  getMyResponse(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollUserResponseState> {
    return this.polls.getUserResponseState(id, request.user);
  }

  @Sse(':id/results/events')
  @ApiOperation({ summary: 'Stream public poll result updates when enabled' })
  streamPollResults(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Query('after') after?: string,
  ): Observable<MessageEvent> {
    return this.polls.streamPublicPollResults(id, this.parseResultCursor(after), request.user);
  }

  @Post(':id/responses')
  @ApiOperation({ summary: 'Submit a response to a published poll' })
  @ApiCreatedResponse({ description: 'Stored poll response.' })
  submitResponse(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: SubmitPollResponseDto,
  ): Promise<PollResponse> {
    return this.polls.submitResponse(id, body, request.user);
  }

  private parseResultCursor(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  private getPollImages(): PollImagesService {
    if (!this.pollImages) {
      throw new Error('Poll image service is not available.');
    }

    return this.pollImages;
  }
}
