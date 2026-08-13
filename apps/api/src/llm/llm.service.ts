import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);

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
    const fallbacks = (
      opts.fallbacks ??
      (this.config.get<string>('LLM_FALLBACKS') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ).filter((m) => m !== opts.model);

    const models = [opts.model, ...fallbacks];
    let lastError: Error | null = null;

    for (const model of models) {
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
          error?: { message?: string };
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
        };

        if (!res.ok) {
          throw new Error(json.error?.message || `Groq HTTP ${res.status}`);
        }

        const raw = json.choices?.[0]?.message?.content || '';
        const cleaned = raw
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const data = JSON.parse(cleaned) as T;
        return {
          data,
          raw: cleaned,
          model: json.model || model,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.log.warn(`LLM model ${model} failed: ${lastError.message}`);
      }
    }

    throw lastError || new Error('All LLM models failed');
  }
}
