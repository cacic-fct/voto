import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { S3Service } from '../s3/s3.service';
import { AdminPollsController } from './admin-polls.controller';
import { PollImagesService } from './poll-images.service';
import { PollsService } from './polls.service';
import { PublicPollsController } from './public-polls.controller';

@Module({
  imports: [AuthModule, FeatureFlagsModule],
  controllers: [AdminPollsController, PublicPollsController],
  providers: [EventManagerIntegrationService, PollImagesService, PollsService, S3Service],
})
export class PollsModule {}
