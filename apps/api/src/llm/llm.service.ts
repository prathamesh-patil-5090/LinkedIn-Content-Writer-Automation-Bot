import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const BUILTIN_FALLBACKS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
];

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private lastCallAt = 0;

  constructor(private readonly config: ConfigService) {}

  async chatJson<T>(opts: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    fallbacks?: string[];
  }): Promise<{ data: T; raw: string; model: string; latencyMs: number }> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');

    const base =
      this.config.get<string>('GROQ_BASE_URL') ||
      'https://api.groq.com/openai/v1';
    const envFallbacks = (this.config.get<string>('LLM_FALLBACKS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const models = unique([
      opts.model,
      ...(opts.fallbacks ?? envFallbacks),
      ...BUILTIN_FALLBACKS,
    ]);

    let lastError: Error | null = null;

    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await this.throttle();
        const started = Date.now();
        try {
          const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: opts.messages,
              temperature: opts.temperature ?? 0.55,
              response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.timeout(120_000),
          });

          const json = (await res.json()) as {
            error?: { message?: string; code?: string };
            model?: string;
            choices?: Array<{ message?: { content?: string } }>;
          };

          if (!res.ok) {
            const msg = json.error?.message || `Groq HTTP ${res.status}`;
            const waitSec = parseRetrySeconds(msg);
            if (waitSec != null && attempt < 3) {
              this.log.warn(
                `${model} rate-limited; waiting ${waitSec.toFixed(1)}s (try ${attempt}/3)`,
              );
              await sleep((waitSec + 0.4) * 1000);
              continue;
            }
            throw new Error(`Groq ${model}: ${msg}`);
          }

          const raw = json.choices?.[0]?.message?.content || '';
          const cleaned = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          const data = JSON.parse(cleaned) as T;
          this.lastCallAt = Date.now();
          if (model !== opts.model) {
            this.log.log(`Fell back to Groq model ${model}`);
          }
          return {
            data,
            raw: cleaned,
            model: json.model || model,
            latencyMs: Date.now() - started,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const msg = lastError.message;
          this.log.warn(`LLM model ${model} failed: ${msg}`);
          if (/too large|not entitled|failed to validate json/i.test(msg)) {
            break;
          }
          const waitSec = parseRetrySeconds(msg);
          if (waitSec != null && attempt < 3) {
            await sleep((waitSec + 0.4) * 1000);
            continue;
          }
          break;
        }
      }
    }

    throw lastError || new Error('All LLM models failed');
  }

  private async throttle() {
    const gapMs = 8_000;
    const wait = gapMs - (Date.now() - this.lastCallAt);
    if (this.lastCallAt && wait > 0) {
      this.log.log(`Groq TPM pause ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function parseRetrySeconds(message: string): number | null {
  const m = message.match(/try again in\s+([\d.]+)\s*s/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 60) : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
