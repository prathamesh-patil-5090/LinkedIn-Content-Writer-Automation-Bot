import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { kickerFrom, makeQuoteCardPng } from './quote-card';
import { makeCardPng } from './local-png';

type OaiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
  message?: string;
};

@Injectable()
export class DeapiService {
  private readonly log = new Logger(DeapiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly media: MediaService,
  ) {}

  async generateAndStore(opts: {
    prompt: string;
    key: string;
    hook?: string;
    source?: string;
    category?: string;
  }): Promise<string | null> {
    if (this.config.get('DEAPI_USE_AI') === 'true') {
      const deapiKey = this.config.get<string>('DEAPI_API_KEY')?.trim();
      if (deapiKey) {
        try {
          const prompt = `${opts.prompt}. Photoreal editorial LinkedIn photo, specific real-world scene, no logos, no watermark, no text, no signatures.`;
          const payload = await this.generateOpenAiCompat(deapiKey, prompt);
          return await this.storeBytesFromPayload(payload, opts.key);
        } catch (err) {
          this.log.warn(
            `deAPI skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    const hook = (opts.hook || opts.prompt.split(/[.!\n]/)[0] || '').trim();
    const source = (opts.source || '').trim();
    try {
      this.log.log(
        `Using ${opts.category || 'default'} quote card: ${hook.slice(0, 60)}`,
      );
      const png = makeQuoteCardPng({
        hook,
        source,
        category: opts.category,
        kicker: kickerFrom(`${hook} ${source} ${opts.prompt}`, opts.category),
      });
      return await this.media.saveImage(png, opts.key, 'image/png');
    } catch (err) {
      this.log.warn(
        `Quote card failed: ${err instanceof Error ? err.message : err}`,
      );
      return this.media.saveImage(makeCardPng(), opts.key, 'image/png');
    }
  }

  private bearer(raw: string) {
    return raw.startsWith('dpn-sk-') ? raw : `dpn-sk-${raw}`;
  }

  private async generateOpenAiCompat(apiKey: string, prompt: string) {
    const base =
      this.config.get<string>('DEAPI_OAI_BASE_URL') ||
      'https://oai.deapi.ai/v1';
    const model =
      this.config.get<string>('DEAPI_IMAGE_MODEL') || 'Flux1schnell';
    const size = this.config.get<string>('DEAPI_IMAGE_SIZE') || '1024x1024';
    const res = await fetch(`${base.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearer(apiKey)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
      signal: AbortSignal.timeout(90_000),
    });
    const json = (await res.json()) as OaiImageResponse;
    if (!res.ok) {
      throw new Error(
        json.error?.message || json.message || `deAPI HTTP ${res.status}`,
      );
    }
    const item = json.data?.[0];
    if (!item?.url && !item?.b64_json) {
      throw new Error('deAPI returned no image');
    }
    return { url: item.url, b64: item.b64_json };
  }

  private async storeBytesFromPayload(
    source: { url?: string; b64?: string },
    key: string,
  ) {
    if (source.b64) {
      return this.media.saveImage(
        Buffer.from(source.b64, 'base64'),
        key,
        'image/png',
      );
    }
    if (!source.url) throw new Error('No image payload');
    const res = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Image download HTTP ${res.status}`);
    return this.media.saveImage(
      Buffer.from(await res.arrayBuffer()),
      key,
      res.headers.get('content-type') || 'image/png',
    );
  }
}
