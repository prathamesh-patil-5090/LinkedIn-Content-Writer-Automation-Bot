import { Module } from '@nestjs/common';
import { LinkedInService } from './linkedin.service';
import { LinkedInController } from './linkedin.controller';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  providers: [LinkedInService],
  controllers: [LinkedInController],
  exports: [LinkedInService],
})
export class LinkedInModule {}
