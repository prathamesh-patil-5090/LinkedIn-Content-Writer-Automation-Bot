import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);

  constructor(private readonly config: ConfigService) {}

  driver(): 'local' | 'b2' {
    return this.config.get('MEDIA_DRIVER') === 'b2' ? 'b2' : 'local';
  }

  configured(): { driver: string; ready: boolean; hint?: string } {
    const driver = this.driver();
    if (driver === 'local') {
      return { driver, ready: true };
    }
    const bucket = this.config.get<string>('B2_BUCKET');
    const keyId = this.config.get<string>('B2_KEY_ID');
    const appKey = this.config.get<string>('B2_APPLICATION_KEY');
    const endpoint = this.config.get<string>('B2_ENDPOINT');
    const ready = Boolean(bucket && keyId && appKey && endpoint);
    return {
      driver,
      ready,
      hint: ready
        ? undefined
        : 'Set B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT',
    };
  }

  async readImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Could not read image (${res.status})`);
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || 'image/png',
      };
    }
    const root = this.config.get<string>('UPLOADS_DIR') || './uploads';
    const rel = url.replace(/^\/uploads\//, '');
    const full = path.join(root, rel);
    const bytes = await fs.readFile(full);
    return { bytes, contentType: 'image/png' };
  }

  async saveImage(bytes: Buffer, key: string, contentType = 'image/png') {
    if (this.driver() === 'b2') {
      try {
        return await this.saveToB2(bytes, key, contentType);
      } catch (err) {
        this.log.warn(
          `B2 upload failed, saving locally: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return this.saveLocal(bytes, key);
  }

  async ping(): Promise<{ ok: boolean; driver: string; url?: string; error?: string }> {
    const driver = this.driver();
    const probe = Buffer.from('linkedin-daily-poster storage check\n');
    const key = `health/ping-${Date.now()}.txt`;
    try {
      if (driver === 'b2') {
        await this.headBucket();
        const url = await this.saveToB2(probe, key, 'text/plain');
        return { ok: true, driver, url };
      }
      const url = await this.saveLocal(probe, key);
      return { ok: true, driver, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Storage ping failed: ${message}`);
      return { ok: false, driver, error: message };
    }
  }

  private s3(): S3Client {
    const region = this.config.get<string>('B2_REGION') || 'us-west-004';
    const endpoint = this.config.get<string>('B2_ENDPOINT');
    return new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: this.config.get<string>('B2_KEY_ID') || '',
        secretAccessKey: this.config.get<string>('B2_APPLICATION_KEY') || '',
      },
      forcePathStyle: true,
    });
  }

  private async headBucket() {
    const bucket = this.config.get<string>('B2_BUCKET');
    if (!bucket) throw new Error('B2_BUCKET is empty');
    await this.s3().send(new HeadBucketCommand({ Bucket: bucket }));
  }

  private async saveToB2(bytes: Buffer, key: string, contentType: string) {
    const bucket = this.config.get<string>('B2_BUCKET');
    if (!bucket) throw new Error('B2_BUCKET is empty');
    await this.s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    const publicBase =
      this.config.get<string>('B2_PUBLIC_BASE_URL') ||
      `${this.config.get('B2_ENDPOINT')}/${bucket}`;
    return `${publicBase.replace(/\/$/, '')}/${key}`;
  }

  private async saveLocal(bytes: Buffer, key: string) {
    const root = this.config.get<string>('UPLOADS_DIR') || './uploads';
    const full = path.join(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    const port = this.config.get('API_PORT') || this.config.get('PORT') || 3001;
    const publicBase =
      this.config.get<string>('UPLOADS_PUBLIC_BASE_URL') ||
      `http://localhost:${port}`;
    return `${publicBase.replace(/\/$/, '')}/uploads/${key.replace(/\\/g, '/')}`;
  }
}
