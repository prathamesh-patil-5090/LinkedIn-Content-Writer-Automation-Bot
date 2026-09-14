import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { PipelineService } from '../pipeline/pipeline.service';
import {
  IST_CRON_HOURS,
  POSTS_PER_DAY,
  cronWindowStatus,
  shouldRunCronSlot,
} from './cron-window';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  onModuleInit() {
    const disabled = this.config.get('CRON_DISABLED') === 'true';
    const enabled = this.config.get('CRON_ENABLED') !== 'false';
    const autoPublish = this.config.get('CRON_AUTO_PUBLISH') !== 'false';
    const win = cronWindowStatus();
    if (disabled || !enabled) {
      this.log.warn(
        `Daily ${POSTS_PER_DAY}-post cron is OFF (CRON_DISABLED=${disabled}, CRON_ENABLED=${enabled}). Slots: ${IST_CRON_HOURS.join(',')} IST.`,
      );
      return;
    }
    this.log.log(
      `Daily ${POSTS_PER_DAY}-post cron ARMED · ${IST_CRON_HOURS.join(',')} Asia/Kolkata · autoPublish=${autoPublish} · now ${win.istHour}:${String(win.istMinute).padStart(2, '0')} IST`,
    );
  }

  /** Six IST slots: 07, 10, 13, 16, 19, 22. Render keeps this process up. */
  @Cron('0 7,10,13,16,19,22 * * *', {
    timeZone: 'Asia/Kolkata',
    name: 'ist-generate-publish',
  })
  async nestSlot() {
    await this.tick('nest');
  }

  async tick(source: 'nest' | 'http', force = false) {
    if (this.config.get('CRON_DISABLED') === 'true') {
      this.log.debug(`Cron tick skipped (${source}): CRON_DISABLED=true`);
      return { ok: true, skipped: 'CRON_DISABLED=true', source };
    }
    if (this.config.get('CRON_ENABLED') === 'false') {
      this.log.debug(`Cron tick skipped (${source}): CRON_ENABLED=false`);
      return { ok: true, skipped: 'CRON_ENABLED=false', source };
    }

    if (!force && !shouldRunCronSlot()) {
      const win = cronWindowStatus();
      return {
        ok: true,
        skipped: 'outside_ist_window',
        source,
        istHour: win.istHour,
        istMinute: win.istMinute,
        hours: IST_CRON_HOURS,
      };
    }

    const settings = await this.prisma.settings.findFirst();
    if (settings && !settings.cronEnabled) {
      return { ok: true, skipped: 'settings.cronEnabled=false', source };
    }

    try {
      const run = await this.pipeline.startRun('cron');
      this.log.log(
        `Cron (${source}) started run ${run.id} · slot ${cronWindowStatus().istHour}:00 IST`,
      );
      return { ok: true, runId: run.id, source };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Cron (${source}) skipped: ${msg}`);
      return { ok: true, skipped: msg, source };
    }
  }
}
