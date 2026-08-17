import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { DeapiService } from './deapi.service';

@Module({
  providers: [MediaService, DeapiService],
  exports: [MediaService, DeapiService],
})
export class MediaModule {}
