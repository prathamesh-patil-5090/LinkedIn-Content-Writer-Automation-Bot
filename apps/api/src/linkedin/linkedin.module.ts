import { Module } from '@nestjs/common';
import { LinkedInService } from './linkedin.service';
import { LinkedInController } from './linkedin.controller';

@Module({
  providers: [LinkedInService],
  controllers: [LinkedInController],
  exports: [LinkedInService],
})
export class LinkedInModule {}
