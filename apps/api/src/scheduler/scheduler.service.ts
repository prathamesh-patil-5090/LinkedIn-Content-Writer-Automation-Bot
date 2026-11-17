import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { PipelineService } from '../pipeline/pipeline.service';
import {
  IST_PUBLISH_SLOTS,
  linkedInCaps,
  linkedInScheduleLabel,
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
    const { postsPerDay, postsPerWeek } = linkedInCaps();
    if (disabled || !enabled) {
      this.log.warn(
        `LinkedIn ${postsPerDay}/day cron is OFF (CRON_DISABLED=${disabled}, CRON_ENABLED=${enabled}). Slots: ${IST_PUBLISH_SLOTS.join(', ')} IST · max ${postsPerWeek}/week.`,
      );
      return;
    }
    this.log.log(
      `LinkedIn cron ARMED · ${linkedInScheduleLabel()} · autoPublish=${autoPublish} · news collect keeps 6×/day · now ${win.istHour}:${String(win.istMinute).padStart(2, '0')} IST`,
    );
  }

  /**
   * LinkedIn publish attempts: 08:30 + 18:30 IST.
   * Daily/weekly caps ensure at most one publish per day.
   */
  @Cron('30 8,18 * * *', {
    timeZone: 'Asia/Kolkata',
    name: 'ist-generate-publish',
  })
  async nestSlot() {
    await this.tick('nest');
  }

  /**
   * High-frequency RSS collect (former 6×/day cadence) — stores SourceEvents
   * for X/Twitter surplus and richer LinkedIn candidate pools. No publish.
   */
  @Cron('0 7,10,13,16,19,22 * * *', {
    timeZone: 'Asia/Kolkata',
    name: 'ist-news-collect',
  })
  async nestCollect() {
    if (this.config.get('CRON_DISABLED') === 'true') return;
    if (this.config.get('CRON_ENABLED') === 'false') return;
    if (this.config.get('COLLECT_CRON_ENABLED') === 'false') return;
    try {
      const result = await this.pipeline.collectFeedOnly();
      this.log.log(
        `News collect: ${result.stories} stories → ${result.sourceEvents} source events`,
      );
    } catch (err) {
      this.log.warn(
        `News collect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
        slots: IST_PUBLISH_SLOTS,
      };
    }

    const settings = await this.prisma.settings.findFirst();
    if (settings && !settings.cronEnabled) {
      return { ok: true, skipped: 'settings.cronEnabled=false', source };
    }

    try {
      const run = await this.pipeline.startRun('cron');
      const win = cronWindowStatus();
      this.log.log(
        `Cron (${source}) started run ${run.id} · ${String(win.istHour).padStart(2, '0')}:${String(win.istMinute).padStart(2, '0')} IST`,
      );
      return { ok: true, runId: run.id, source };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Cron (${source}) skipped: ${msg}`);
      return { ok: true, skipped: msg, source };
    }
  }
}
