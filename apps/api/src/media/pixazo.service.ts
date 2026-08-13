import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaService } from '../media/media.service';

@Injectable()
export class PixazoService {
  private readonly log = new Logger(PixazoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly media: MediaService,
  ) {}

  async generateAndStore(opts: {
    prompt: string;
    key: string;
  }): Promise<string | null> {
    const apiKey = this.config.get<string>('PIXAZO_API_KEY');
    if (!apiKey) {
      this.log.warn('PIXAZO_API_KEY missing — skipping image');
      return null;
    }

    const base =
      this.config.get<string>('PIXAZO_BASE_URL') ||
      'https://gateway.pixazo.ai';
    const width = Number(this.config.get('PIXAZO_IMAGE_WIDTH') || 1024);
    const height = Number(this.config.get('PIXAZO_IMAGE_HEIGHT') || 1024);
    const steps = Number(this.config.get('PIXAZO_NUM_STEPS') || 4);

    const attempts = [
      {
        name: 'flux-schnell',
        path:
          this.config.get('PIXAZO_IMAGE_ENDPOINT') ||
          '/flux-1-schnell/v1/getData',
        body: {
          prompt: opts.prompt,
          num_steps: steps,
          width,
          height,
        },
      },
      {
        name: 'sdxl',
        path:
          this.config.get('PIXAZO_FALLBACK_ENDPOINT') ||
          '/getImage/v1/getSDXLImage',
        body: {
          prompt: opts.prompt,
          width,
          height,
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        const res = await fetch(`${base}${attempt.path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Ocp-Apim-Subscription-Key': apiKey,
          },
          body: JSON.stringify(attempt.body),
          signal: AbortSignal.timeout(90_000),
        });
        const json = (await res.json()) as {
          output?: string;
          error?: string;
          message?: string;
        };
        if (!res.ok || !json.output) {
          throw new Error(
            json.error || json.message || `Pixazo ${attempt.name} HTTP ${res.status}`,
          );
        }
        const imgRes = await fetch(json.output, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!imgRes.ok) throw new Error(`Download image failed ${imgRes.status}`);
        const bytes = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get('content-type') || 'image/png';
        const stored = await this.media.saveImage(bytes, opts.key, contentType);
        return stored;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Pixazo ${attempt.name} failed: ${msg}`);
      }
    }
    return null;
  }
}
