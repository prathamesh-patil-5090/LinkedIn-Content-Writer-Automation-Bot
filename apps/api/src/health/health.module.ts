import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';
import { LinkedInModule } from '../linkedin/linkedin.module';

@Module({
  imports: [NotificationsModule, MediaModule, LinkedInModule],
  controllers: [HealthController],
})
export class HealthModule {}
