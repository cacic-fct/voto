import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventManagerIntegrationService } from '../event-manager/event-manager-integration.service';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { S3Service } from '../s3/s3.service';
import { AdminPollsController } from './admin-polls.controller';
import { PollEligibilityService } from './poll-eligibility.service';
import { PollElementMutationsService } from './poll-element-mutations.service';
import { PollImageMutationsService } from './poll-image-mutations.service';
import { PollImagesService } from './poll-images.service';
import { PollMutationOptionsService } from './poll-mutation-options.service';
import { PollMutationValidationService } from './poll-mutation-validation.service';
import { PollMutationsService } from './poll-mutations.service';
import { PollResponsesService } from './poll-responses.service';
import { PollResultsService } from './poll-results.service';
import { PollsService } from './polls.service';
import { PublicPollsController } from './public-polls.controller';

@Module({
  imports: [AuthModule, FeatureFlagsModule],
  controllers: [AdminPollsController, PublicPollsController],
  providers: [
    EventManagerIntegrationService,
    PollEligibilityService,
    PollElementMutationsService,
    PollImageMutationsService,
    PollImagesService,
    PollMutationOptionsService,
    PollMutationValidationService,
    PollMutationsService,
    PollResponsesService,
    PollResultsService,
    PollsService,
    S3Service,
  ],
})
export class PollsModule {}
