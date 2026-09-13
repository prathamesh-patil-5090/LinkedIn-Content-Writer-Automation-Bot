import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from '../notifications/telegram.service';

const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes

/**
 * When Postgres/Prisma is down: ping Telegram once per cooldown and
 * optionally POST a Render deploy hook to bounce the service.
 */
@Injectable()
export class DbRecoveryService {
  private readonly log = new Logger(DbRecoveryService.name);
  private lastActionAt = 0;
  private lastReason = '';

  constructor(
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  cooldownMs() {
    const raw = Number(this.config.get('DB_RECOVERY_COOLDOWN_MS') || '');
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COOLDOWN_MS;
  }

  async handleFailure(reason: string): Promise<{
    ok: boolean;
    triggered: boolean;
    telegram?: boolean;
    deployHook?: boolean;
    cooldownSec?: number;
    error?: string;
  }> {
    const now = Date.now();
    const cooldown = this.cooldownMs();
    if (now - this.lastActionAt < cooldown) {
      return {
        ok: false,
        triggered: false,
        cooldownSec: Math.ceil((cooldown - (now - this.lastActionAt)) / 1000),
      };
    }
    this.lastActionAt = now;
    this.lastReason = reason;

    const msg = [
      'DB connection failure detected.',
      reason.slice(0, 500),
      this.config.get('RENDER_DEPLOY_HOOK_URL')?.trim()
        ? 'Triggering Render deploy hook…'
        : 'No RENDER_DEPLOY_HOOK_URL set — skipped redeploy.',
    ].join('\n');

    let telegramOk = false;
    try {
      const ping = await this.telegram.ping(msg);
      telegramOk = ping.ok;
      if (!ping.ok) {
        this.log.warn(`Telegram DB alert failed: ${ping.error}`);
      }
    } catch (err) {
      this.log.warn(
        `Telegram DB alert error: ${err instanceof Error ? err.message : err}`,
      );
    }

    let deployOk = false;
    const hook = this.config.get<string>('RENDER_DEPLOY_HOOK_URL')?.trim();
    if (hook) {
      try {
        const res = await fetch(hook, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        });
        deployOk = res.ok;
        if (!res.ok) {
          this.log.warn(`Render deploy hook HTTP ${res.status}`);
        } else {
          this.log.warn('Render deploy hook triggered after DB failure');
        }
      } catch (err) {
        this.log.warn(
          `Render deploy hook failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    return {
      ok: telegramOk || deployOk,
      triggered: true,
      telegram: telegramOk,
      deployHook: deployOk,
    };
  }

  status() {
    return {
      lastActionAt: this.lastActionAt || null,
      lastReason: this.lastReason || null,
      cooldownMs: this.cooldownMs(),
    };
  }
}

/** Standalone helper for Prisma boot (no Nest DI yet). */
export async function reportDbFailureStandalone(reason: string) {
  const hook = process.env.RENDER_DEPLOY_HOOK_URL?.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const key = 'ldp_db_recovery_last';
  const g = globalThis as unknown as Record<string, number>;
  const now = Date.now();
  const cooldown = Number(process.env.DB_RECOVERY_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS;
  if (now - (g[key] || 0) < cooldown) return;
  g[key] = now;

  if (token && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `DB connection failure on boot.\n${reason.slice(0, 500)}${
            hook ? '\nTriggering Render deploy hook…' : ''
          }`,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      /* ignore */
    }
  }
  if (hook) {
    try {
      await fetch(hook, {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      /* ignore */
    }
  }
}
