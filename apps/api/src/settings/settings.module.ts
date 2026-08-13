import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [NotificationsModule, MediaModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
