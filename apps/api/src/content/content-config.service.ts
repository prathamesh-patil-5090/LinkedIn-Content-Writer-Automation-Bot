import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentPillar,
  DEFAULT_PILLAR_WEIGHTS,
  type ContentPillar as Pillar,
} from '@ldp/shared';

@Injectable()
export class ContentConfigService {
  constructor(private readonly config: ConfigService) {}

  /** Manual Generate never auto-publishes; only cron uses CRON_AUTO_PUBLISH. */
  autonomousPublish(): boolean {
    return false;
  }

  contentScoreThreshold(): number {
    return num(this.config.get('CONTENT_SCORE_THRESHOLD'), 6);
  }

  qualityScoreThreshold(): number {
    return num(this.config.get('QUALITY_SCORE_THRESHOLD'), 5.5);
  }

  authenticityThreshold(): number {
    return num(this.config.get('AUTHENTICITY_THRESHOLD'), 5);
  }

  aiGenericnessMax(): number {
    return num(this.config.get('AI_GENERICNESS_MAX'), 5);
  }

  similarityReject(): number {
    return num(this.config.get('SIMILARITY_REJECT'), 0.72);
  }

  similarityRewrite(): number {
    return num(this.config.get('SIMILARITY_REWRITE'), 0.55);
  }

  maxRegenerationAttempts(): number {
    return Math.max(0, Math.floor(num(this.config.get('MAX_REGENERATION_ATTEMPTS'), 3)));
  }

  pillarWeights(): Record<Pillar, number> {
    const raw = this.config.get<string>('PILLAR_WEIGHTS_JSON');
    if (!raw) return { ...DEFAULT_PILLAR_WEIGHTS };
    try {
      const parsed = JSON.parse(raw) as Record<string, number>;
      const out = { ...DEFAULT_PILLAR_WEIGHTS };
      for (const p of ContentPillar.options) {
        if (typeof parsed[p] === 'number' && parsed[p] >= 0) {
          out[p] = parsed[p];
        }
      }
      const sum = Object.values(out).reduce((a, b) => a + b, 0);
      if (sum <= 0) return { ...DEFAULT_PILLAR_WEIGHTS };
      for (const p of ContentPillar.options) {
        out[p] = out[p] / sum;
      }
      return out;
    } catch {
      return { ...DEFAULT_PILLAR_WEIGHTS };
    }
  }

  feedbackMinSampleSize(): number {
    return Math.max(1, Math.floor(num(this.config.get('FEEDBACK_MIN_SAMPLE'), 8)));
  }

  githubToken(): string | undefined {
    return this.config.get<string>('GITHUB_TOKEN') || undefined;
  }

  githubRepos(): string[] {
    const raw = this.config.get<string>('GITHUB_REPOS') || '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  cragProjectLabel(): string {
    return this.config.get<string>('CRAG_PROJECT_LABEL') || 'CRag';
  }
}

function num(v: string | number | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
