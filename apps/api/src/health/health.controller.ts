import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { TelegramService } from '../notifications/telegram.service';
import { MediaService } from '../media/media.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly media: MediaService,
  ) {}

  @Get()
  async check() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      ok: db === 'up',
      db,
      telegram: this.telegram.configured(),
      storage: this.media.configured(),
    };
  }
}
