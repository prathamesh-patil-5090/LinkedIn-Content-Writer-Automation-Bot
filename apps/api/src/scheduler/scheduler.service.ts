import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { shouldRunCronSlot } from './cron-window';

@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  /** In-process timer — Render keeps this API process running. */
  @Cron('0 7,10,13,16,19,22 * * *', {
    timeZone: 'Asia/Kolkata',
    name: 'ist-generate-publish',
  })
  async nestSlot() {
    await this.tick('nest');
  }

  async tick(source: 'nest' | 'http', force = false) {
    if (this.config.get('CRON_ENABLED') === 'false') {
      return { ok: true, skipped: 'CRON_ENABLED=false', source };
    }

    if (!force && !shouldRunCronSlot()) {
      return { ok: true, skipped: 'outside_ist_window', source };
    }

    const settings = await this.prisma.settings.findFirst();
    if (settings && !settings.cronEnabled) {
      return { ok: true, skipped: 'settings.cronEnabled=false', source };
    }

    try {
      const run = await this.pipeline.startRun('cron');
      this.log.log(`Cron (${source}) started run ${run.id}`);
      return { ok: true, runId: run.id, source };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Cron (${source}) skipped: ${msg}`);
      return { ok: true, skipped: msg, source };
    }
  }
}
