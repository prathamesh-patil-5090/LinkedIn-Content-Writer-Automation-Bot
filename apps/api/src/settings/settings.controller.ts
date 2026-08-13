import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { CurrentUser, SessionAuthGuard, SessionUser } from '../auth/session.guard';
import { TelegramService } from '../notifications/telegram.service';
import { MediaService } from '../media/media.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  cronEnabled?: boolean;

  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;
}

@Controller('settings')
@UseGuards(SessionAuthGuard)
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
    private readonly media: MediaService,
  ) {}

  @Get()
  async get(@CurrentUser() user: SessionUser) {
    const row = await this.prisma.settings.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    const telegram = this.telegram.configured();
    const storage = this.media.configured();
    return {
      ...row,
      integrations: {
        telegram: {
          envTokenSet: Boolean(this.config.get('TELEGRAM_BOT_TOKEN')),
          envChatIdSet: Boolean(this.config.get('TELEGRAM_CHAT_ID')),
          ready: telegram.ready,
        },
        storage,
      },
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: SessionUser,
    @Body() body: UpdateSettingsDto,
  ) {
    return this.prisma.settings.upsert({
      where: { userId: user.id },
      update: {
        timezone: body.timezone,
        cronEnabled: body.cronEnabled,
        telegramChatId: body.telegramChatId,
        telegramEnabled: body.telegramEnabled,
      },
      create: {
        userId: user.id,
        timezone: body.timezone ?? 'Asia/Kolkata',
        cronEnabled: body.cronEnabled ?? true,
        telegramChatId: body.telegramChatId,
        telegramEnabled: body.telegramEnabled ?? false,
      },
    });
  }

  @Post('test-telegram')
  async testTelegram() {
    return this.telegram.ping();
  }

  @Post('test-storage')
  async testStorage() {
    return this.media.ping();
  }
}
