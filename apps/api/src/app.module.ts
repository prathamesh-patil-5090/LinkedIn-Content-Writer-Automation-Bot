import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RunsModule } from './runs/runs.module';
import { VoiceModule } from './voice/voice.module';
import { SettingsModule } from './settings/settings.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { LinkedInModule } from './linkedin/linkedin.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { NewsModule } from './news/news.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    MediaModule,
    NotificationsModule,
    NewsModule,
    PipelineModule,
    LinkedInModule,
    RunsModule,
    VoiceModule,
    SettingsModule,
    HealthModule,
    SchedulerModule,
  ],
})
export class AppModule {}
