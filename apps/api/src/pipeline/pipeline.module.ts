import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { NewsModule } from '../news/news.module';
import { AgentsModule } from '../agents/agents.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LinkedInModule } from '../linkedin/linkedin.module';
import { ContentModule } from '../content/content.module';

@Module({
  imports: [
    NewsModule,
    AgentsModule,
    MediaModule,
    NotificationsModule,
    LinkedInModule,
    ContentModule,
  ],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
