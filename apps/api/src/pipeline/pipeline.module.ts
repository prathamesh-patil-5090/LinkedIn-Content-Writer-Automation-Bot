import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { NewsModule } from '../news/news.module';
import { AgentsModule } from '../agents/agents.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LinkedInModule } from '../linkedin/linkedin.module';

@Module({
  imports: [
    NewsModule,
    AgentsModule,
    MediaModule,
    NotificationsModule,
    LinkedInModule,
  ],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
