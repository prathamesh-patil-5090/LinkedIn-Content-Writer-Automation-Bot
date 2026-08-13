import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { PipelineService } from '../pipeline/pipeline.service';

@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata', name: 'daily-generate' })
  async dailyGenerate() {
    const envEnabled = this.config.get('CRON_ENABLED') !== 'false';
    if (!envEnabled) {
      this.log.log('CRON_ENABLED=false — skipping');
      return;
    }

    const settings = await this.prisma.settings.findFirst();
    if (settings && !settings.cronEnabled) {
      this.log.log('Settings cronEnabled=false — skipping');
      return;
    }

    try {
      const run = await this.pipeline.startRun('cron');
      this.log.log(`Cron started run ${run.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Cron skipped: ${msg}`);
    }
  }
}
