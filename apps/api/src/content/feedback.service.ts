import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { ContentConfigService } from './content-config.service';
import type { ContentPillar } from '@ldp/shared';

@Injectable()
export class FeedbackService {
  private readonly log = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ContentConfigService,
  ) {}

  async recordPublishStub(opts: {
    runId: string;
    draftId?: string;
    linkedinPostUrn?: string | null;
    pillar?: string | null;
    format?: string | null;
    hook?: string | null;
    contentScore?: number | null;
    qualityScore?: number | null;
    publishedAt?: Date | null;
  }) {
    await this.prisma.publishedPostPerformance.upsert({
      where: { runId: opts.runId },
      create: {
        runId: opts.runId,
        draftId: opts.draftId,
        linkedinPostUrn: opts.linkedinPostUrn || undefined,
        pillar: opts.pillar || undefined,
        format: opts.format || undefined,
        hook: opts.hook || undefined,
        contentScore: opts.contentScore ?? undefined,
        qualityScore: opts.qualityScore ?? undefined,
        publishedAt: opts.publishedAt || new Date(),
        impressions: 0,
        reactions: 0,
        comments: 0,
        reposts: 0,
        clicks: 0,
        metricsJson: { stub: true, note: 'LinkedIn engagement sync not available' },
      },
      update: {
        draftId: opts.draftId,
        linkedinPostUrn: opts.linkedinPostUrn || undefined,
        pillar: opts.pillar || undefined,
        format: opts.format || undefined,
        hook: opts.hook || undefined,
        contentScore: opts.contentScore ?? undefined,
        qualityScore: opts.qualityScore ?? undefined,
        publishedAt: opts.publishedAt || new Date(),
      },
    });
  }

  /**
   * Cautious pillar boosts only when sample size is large enough.
   * Engagement fields are stubbed at 0 until LinkedIn analytics scopes exist.
   */
  async cautiousPillarHints(): Promise<{
    sampleSize: number;
    boosts: Partial<Record<ContentPillar, number>>;
    note: string;
  }> {
    const min = this.config.feedbackMinSampleSize();
    const rows = await this.prisma.publishedPostPerformance.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: {
        pillar: true,
        reactions: true,
        comments: true,
        impressions: true,
      },
    });
    if (rows.length < min) {
      return {
        sampleSize: rows.length,
        boosts: {},
        note: `Need >= ${min} published samples before feedback boosts (have ${rows.length})`,
      };
    }

    const byPillar = new Map<string, { n: number; eng: number }>();
    for (const r of rows) {
      if (!r.pillar) continue;
      const eng = r.reactions + r.comments * 2 + Math.min(r.impressions, 1000) / 100;
      const cur = byPillar.get(r.pillar) || { n: 0, eng: 0 };
      cur.n += 1;
      cur.eng += eng;
      byPillar.set(r.pillar, cur);
    }

    // With all-zero metrics, boosts stay flat — no overfitting on noise.
    const boosts: Partial<Record<ContentPillar, number>> = {};
    let anyNonZero = false;
    for (const [, v] of byPillar) {
      if (v.eng > 0) anyNonZero = true;
    }
    if (!anyNonZero) {
      return {
        sampleSize: rows.length,
        boosts: {},
        note: 'Metrics still stubbed at zero; no pillar boost applied',
      };
    }

    const avg =
      [...byPillar.values()].reduce((a, b) => a + b.eng / Math.max(1, b.n), 0) /
      Math.max(1, byPillar.size);
    for (const [p, v] of byPillar) {
      const mean = v.eng / Math.max(1, v.n);
      if (v.n >= 3 && mean > avg * 1.15) {
        boosts[p as ContentPillar] = Math.min(1.5, (mean / avg - 1) * 2);
      }
    }
    this.log.log(`Feedback boosts from ${rows.length} posts: ${JSON.stringify(boosts)}`);
    return {
      sampleSize: rows.length,
      boosts,
      note: 'Cautious relative engagement boosts',
    };
  }
}
