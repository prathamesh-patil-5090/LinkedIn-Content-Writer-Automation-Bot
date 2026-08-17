import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private readonly log = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  configured(): { ready: boolean; hint?: string } {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    const ready = Boolean(token && chatId);
    return {
      ready,
      hint: ready
        ? undefined
        : 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in apps/api/.env',
    };
  }

  async ping(text?: string): Promise<{ ok: boolean; error?: string }> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing' };
    }

    const message =
      text ??
      'LinkedIn Daily Poster is connected. You will get a ping here when a draft is ready.';

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            disable_web_page_preview: true,
          }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; description?: string };
      if (!json.ok) {
        return { ok: false, error: json.description || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const messageErr = err instanceof Error ? err.message : String(err);
      this.log.warn(`Telegram ping failed: ${messageErr}`);
      return { ok: false, error: messageErr };
    }
  }
}
