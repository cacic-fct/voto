import { Module } from '@nestjs/common';
import { FeatureFlagService } from './feature-flags.service';

@Module({
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagsModule {}

