import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { PixazoService } from './pixazo.service';

@Module({
  providers: [MediaService, PixazoService],
  exports: [MediaService, PixazoService],
})
export class MediaModule {}
