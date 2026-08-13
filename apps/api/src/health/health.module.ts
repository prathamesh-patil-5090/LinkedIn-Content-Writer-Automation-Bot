import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [NotificationsModule, MediaModule],
  controllers: [HealthController],
})
export class HealthModule {}
