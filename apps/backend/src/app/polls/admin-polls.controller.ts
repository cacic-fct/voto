import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EventManagerEvent,
  AdminCacicElectionSlate,
  Poll,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollImage,
  PollResults,
  PollSummary,
} from '@org/voting-contracts';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { AuthenticatedPrincipal, AuthenticatedRequest } from '../auth/auth.types';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  AddPollEligibilityEnrollmentsDto,
  ImportPollEligibilityEnrollmentsDto,
  PollStatusDto,
  RejectCacicElectionSlateDto,
  SavePollDto,
  UpdateCacicElectionSlateDto,
  UpdateCacicElectionSlateEnabledDto,
} from './dto/poll.dto';
import { PollsService } from './polls.service';
import {
  MAX_POLL_IMAGE_FILE_SIZE_BYTES,
  UploadedPollImageFile,
  isAllowedPollImageMimeType,
} from './poll-image.utils';
import { PollImagesService } from './poll-images.service';

class PollImageUploadBodyDto {
  @ApiProperty({
    description: 'Image file selected in the admin poll builder.',
    type: 'string',
    format: 'binary',
  })
  file!: unknown;
}

@ApiTags('Admin polls')
@ApiCookieAuth()
@Controller('admin/polls')
export class AdminPollsController {
  constructor(
    private readonly polls: PollsService,
    private readonly pollImages?: PollImagesService,
  ) {}

  @Get()
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'List all polls for administrators' })
  @ApiOkResponse({ description: 'Poll summaries ordered by last update.' })
  listPolls(): Promise<PollSummary[]> {
    return this.polls.listAdminPolls();
  }

  @Get('linkable-events')
  @RequirePermissions('poll#create')
  @ApiOperation({ summary: 'List Event Manager events available for poll links' })
  @ApiOkResponse({ description: 'Events happening today or in the future.' })
  listLinkableEvents(): Promise<EventManagerEvent[]> {
    return this.polls.listLinkableEvents();
  }

  @Get(':id/eligibility-enrollments')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'List enrollment numbers allowed to vote in a poll' })
  @ApiOkResponse({ description: 'Enrollment numbers enriched with Event Manager display data when available.' })
  listEligibilityEnrollments(@Param('id') id: string): Promise<PollEligibilityEnrollmentList> {
    return this.polls.listEligibilityEnrollments(id);
  }

  @Post(':id/eligibility-enrollments')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Add enrollment numbers allowed to vote in a poll' })
  @ApiBody({ type: AddPollEligibilityEnrollmentsDto })
  @ApiCreatedResponse({ description: 'Updated enrollment eligibility list.' })
  addEligibilityEnrollments(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: AddPollEligibilityEnrollmentsDto,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    return this.polls.addEligibilityEnrollments(id, body, this.getUser(request));
  }

  @Put(':id/eligibility-enrollments/import')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Import enrollment numbers from TXT or CSV content' })
  @ApiBody({ type: ImportPollEligibilityEnrollmentsDto })
  @ApiOkResponse({ description: 'Import summary and updated enrollment eligibility list.' })
  importEligibilityEnrollments(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: ImportPollEligibilityEnrollmentsDto,
  ): Promise<PollEligibilityEnrollmentImportResult> {
    return this.polls.importEligibilityEnrollments(id, body, this.getUser(request));
  }

  @Delete(':id/eligibility-enrollments')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Remove every enrollment number from a poll eligibility list' })
  @ApiOkResponse({ description: 'Empty enrollment eligibility list.' })
  clearEligibilityEnrollments(@Param('id') id: string): Promise<PollEligibilityEnrollmentList> {
    return this.polls.clearEligibilityEnrollments(id);
  }

  @Delete(':id/eligibility-enrollments/:enrollmentNumber')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Remove one enrollment number from a poll eligibility list' })
  @ApiNoContentResponse({ description: 'Enrollment number removed when present.' })
  async deleteEligibilityEnrollment(
    @Param('id') id: string,
    @Param('enrollmentNumber') enrollmentNumber: string,
  ): Promise<void> {
    await this.polls.deleteEligibilityEnrollment(id, enrollmentNumber);
  }

  @Get(':id/results')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'Read poll responses and voter metadata for administrators' })
  @ApiOkResponse({ description: 'Poll results with response answers and identity data when available.' })
  getPollResults(@Param('id') id: string): Promise<PollResults> {
    return this.polls.getAdminPollResults(id);
  }

  @Get(':id/cacic-election/voter-enrollments.txt')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'Download enrollment numbers for voters in a closed CACiC election' })
  @ApiOkResponse({ description: 'Plain text with one enrollment number per line.' })
  async exportCacicElectionVoterEnrollments(
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.polls.exportCacicElectionVoterEnrollments(id);
    response
      .type('text/plain; charset=utf-8')
      .attachment(`cacic-election-${id}-voters.txt`)
      .send(content);
  }

  @Sse(':id/results/events')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'Stream new poll result responses for administrators' })
  streamPollResults(@Param('id') id: string, @Query('after') after?: string): Observable<MessageEvent> {
    return this.polls.streamAdminPollResults(id, this.parseResultCursor(after));
  }

  @Get(':id/cacic-election/slates')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'List CACiC election slate submissions for administrator review' })
  @ApiOkResponse({ description: 'Slate submissions including private identifier fields for administrator review.' })
  listCacicElectionSlates(@Param('id') id: string): Promise<AdminCacicElectionSlate[]> {
    return this.polls.listAdminCacicElectionSlates(id);
  }

  @Post(':id/cacic-election/slates')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Create a CACiC election slate manually as an administrator' })
  @ApiBody({ type: UpdateCacicElectionSlateDto })
  @ApiCreatedResponse({ description: 'Created slate submission.' })
  createCacicElectionSlate(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateCacicElectionSlateDto,
  ): Promise<AdminCacicElectionSlate> {
    return this.polls.createAdminCacicElectionSlate(id, body, this.getUser(request));
  }

  @Put(':id/cacic-election/slates/:slateId')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Replace a CACiC election slate submission as an administrator' })
  @ApiBody({ type: UpdateCacicElectionSlateDto })
  @ApiOkResponse({ description: 'Updated slate submission.' })
  updateCacicElectionSlate(
    @Param('id') id: string,
    @Param('slateId') slateId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateCacicElectionSlateDto,
  ): Promise<AdminCacicElectionSlate> {
    return this.polls.updateAdminCacicElectionSlate(id, slateId, body, this.getUser(request));
  }

  @Patch(':id/cacic-election/slates/:slateId/rejection')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Reject a CACiC election slate submission with a reason' })
  @ApiBody({ type: RejectCacicElectionSlateDto })
  @ApiOkResponse({ description: 'Rejected slate submission.' })
  rejectCacicElectionSlate(
    @Param('id') id: string,
    @Param('slateId') slateId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: RejectCacicElectionSlateDto,
  ): Promise<AdminCacicElectionSlate> {
    return this.polls.rejectCacicElectionSlate(id, slateId, body, this.getUser(request));
  }

  @Patch(':id/cacic-election/slates/:slateId/enabled')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Enable or disable an approved CACiC election slate' })
  @ApiBody({ type: UpdateCacicElectionSlateEnabledDto })
  @ApiOkResponse({ description: 'Updated slate submission.' })
  updateCacicElectionSlateEnabled(
    @Param('id') id: string,
    @Param('slateId') slateId: string,
    @Body() body: UpdateCacicElectionSlateEnabledDto,
  ): Promise<AdminCacicElectionSlate> {
    return this.polls.updateCacicElectionSlateEnabled(id, slateId, body);
  }

  @Delete(':id/cacic-election/slates/:slateId')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Delete a CACiC election slate submission' })
  @ApiNoContentResponse({ description: 'Slate submission deleted.' })
  async deleteCacicElectionSlate(
    @Param('id') id: string,
    @Param('slateId') slateId: string,
  ): Promise<void> {
    await this.polls.deleteCacicElectionSlate(id, slateId);
  }

  @Get(':id')
  @RequirePermissions('poll#read')
  @ApiOperation({ summary: 'Read a poll draft or published poll for administrators' })
  @ApiOkResponse({ description: 'Full poll definition.' })
  getPoll(@Param('id') id: string): Promise<Poll> {
    return this.polls.getAdminPoll(id);
  }

  @Post(':id/images')
  @RequirePermissions('poll#edit')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_POLL_IMAGE_FILE_SIZE_BYTES,
        files: 1,
      },
      fileFilter: (
        _request,
        file: UploadedPollImageFile,
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (!isAllowedPollImageMimeType(file.mimetype)) {
          callback(new BadRequestException('A imagem precisa estar em um formato raster suportado.'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Upload an image for poll descriptions or items' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: PollImageUploadBodyDto })
  @ApiCreatedResponse({ description: 'Stored AVIF image metadata.' })
  @ApiResponse({ status: 413, description: 'Returned when the uploaded file exceeds the configured image size limit.' })
  uploadPollImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedPollImageFile | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PollImage> {
    return this.getPollImages().uploadPollImage(id, file, this.getUser(request));
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Delete an image uploaded for a poll' })
  @ApiNoContentResponse({ description: 'Image deleted when present.' })
  async deletePollImage(@Param('id') id: string, @Param('imageId') imageId: string): Promise<void> {
    await this.getPollImages().deletePollImage(id, imageId);
  }

  @Post()
  @RequirePermissions('poll#create')
  @ApiOperation({ summary: 'Create a poll' })
  @ApiCreatedResponse({ description: 'Created poll.' })
  createPoll(@Req() request: AuthenticatedRequest, @Body() body: SavePollDto): Promise<Poll> {
    return this.polls.createPoll(body, this.getUser(request));
  }

  @Put(':id')
  @RequirePermissions('poll#edit')
  @ApiOperation({ summary: 'Replace a poll definition' })
  @ApiOkResponse({ description: 'Updated poll.' })
  updatePoll(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Body() body: SavePollDto): Promise<Poll> {
    return this.polls.updatePoll(id, body, this.getUser(request));
  }

  @Patch(':id/status')
  @RequirePermissions('poll#publish')
  @ApiOperation({ summary: 'Publish, close, or reopen a poll' })
  @ApiOkResponse({ description: 'Poll with updated status.' })
  updateStatus(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Body() body: PollStatusDto): Promise<Poll> {
    return this.polls.updatePollStatus(id, body.status, this.getUser(request));
  }

  @Delete(':id')
  @RequirePermissions('poll#delete')
  @ApiOperation({ summary: 'Delete a poll and its responses' })
  @ApiNoContentResponse({ description: 'Poll deleted.' })
  async deletePoll(@Param('id') id: string): Promise<void> {
    await this.polls.deletePoll(id);
  }

  private getUser(request: AuthenticatedRequest): AuthenticatedPrincipal {
    if (!request.user) {
      throw new UnauthorizedException('Missing authenticated user.');
    }

    return request.user;
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
