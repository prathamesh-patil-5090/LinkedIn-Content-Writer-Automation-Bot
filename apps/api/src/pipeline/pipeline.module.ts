import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { NewsModule } from '../news/news.module';
import { AgentsModule } from '../agents/agents.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NewsModule, AgentsModule, MediaModule, NotificationsModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
