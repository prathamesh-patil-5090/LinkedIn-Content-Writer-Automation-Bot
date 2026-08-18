import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { TelegramService } from '../notifications/telegram.service';
import { MediaService } from '../media/media.service';
import { LinkedInService } from '../linkedin/linkedin.service';
import {
  contentTypeForHour,
  cronWindowStatus,
} from '../scheduler/cron-window';

const startedAt = Date.now();

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly media: MediaService,
    private readonly linkedin: LinkedInService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return { ok: true, status: 'live' };
  }

  @Get('ready')
  async ready() {
    const body = await this.snapshot();
    return { ok: body.ok, db: body.db };
  }

  @Get()
  async check() {
    return this.snapshot();
  }

  private async snapshot() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    return {
      ok: db === 'up',
      service: 'ldp-api',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      db,
      groq: { ready: Boolean(this.config.get('GROQ_API_KEY')) },
      linkedin: { configured: this.linkedin.configured() },
      telegram: this.telegram.configured(),
      storage: this.media.configured(),
      cron: {
        driver: 'nest',
        enabled: this.config.get('CRON_ENABLED') !== 'false',
        autoPublish: this.config.get('CRON_AUTO_PUBLISH') !== 'false',
        ...cronWindowStatus(),
        nextType: contentTypeForHour(cronWindowStatus().istHour, false),
      },
    };
  }
}
