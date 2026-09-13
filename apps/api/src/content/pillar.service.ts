import { Injectable } from '@nestjs/common';
import {
  ContentPillar,
  type ContentPillar as Pillar,
} from '@ldp/shared';
import { PrismaService } from '../prisma/prisma.module';
import { ContentConfigService } from './content-config.service';

@Injectable()
export class PillarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ContentConfigService,
  ) {}

  classify(opts: {
    title: string;
    summary?: string;
    why?: string;
    angle?: string;
  }): Pillar {
    const text =
      `${opts.title} ${opts.summary || ''} ${opts.why || ''} ${opts.angle || ''}`.toLowerCase();
    if (
      /shipped|building in public|build in public|launch|mrr|users|open source project/i.test(
        text,
      )
    ) {
      return 'build_in_public';
    }
    if (
      /product|roadmap|pricing|feature|ux|onboarding|retention/i.test(text)
    ) {
      return 'product';
    }
    if (
      /career|interview|burnout| mentorship|personal|life lesson|imposter/i.test(
        text,
      )
    ) {
      return 'personal';
    }
    return 'engineering';
  }

  /** Last N published/draft metas — counts per pillar. */
  async recentDistribution(limit = 20): Promise<Record<Pillar, number>> {
    const rows = await this.prisma.contentDraftMeta.findMany({
      where: {
        OR: [
          { decision: 'approved' },
          { decision: 'published' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { pillar: true },
    });
    const counts: Record<Pillar, number> = {
      engineering: 0,
      build_in_public: 0,
      product: 0,
      personal: 0,
    };
    for (const r of rows) {
      const p = ContentPillar.safeParse(r.pillar);
      if (p.success) counts[p.data] += 1;
    }
    // Fallback: published runs without meta
    if (rows.length < 5) {
      const drafts = await this.prisma.draft.findMany({
        where: { status: { in: ['approved', 'auto_approved'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { chosenStyle: true, sourceTitle: true, postText: true },
      });
      for (const d of drafts) {
        const p = this.classify({
          title: d.sourceTitle || '',
          summary: d.postText?.slice(0, 200),
          angle: d.chosenStyle || undefined,
        });
        counts[p] += 1;
      }
    }
    return counts;
  }

  /**
   * Prefer underrepresented pillars vs target weights.
   * Returns boost map (higher = more needed).
   */
  async diversityBoosts(limit = 20): Promise<Record<Pillar, number>> {
    const counts = await this.recentDistribution(limit);
    const total = Math.max(
      1,
      Object.values(counts).reduce((a, b) => a + b, 0),
    );
    const weights = this.config.pillarWeights();
    const boosts: Record<Pillar, number> = {
      engineering: 0,
      build_in_public: 0,
      product: 0,
      personal: 0,
    };
    for (const p of ContentPillar.options) {
      const actual = counts[p] / total;
      const target = weights[p];
      // Positive when underrepresented
      boosts[p] = Math.max(0, target - actual) * 10;
    }
    return boosts;
  }

  pickPreferredPillar(
    candidates: Array<{ pillar: Pillar; contentScore: number }>,
    boosts: Record<Pillar, number>,
  ): Pillar | null {
    if (!candidates.length) return null;
    let best = candidates[0];
    let bestScore = best.contentScore + (boosts[best.pillar] || 0);
    for (const c of candidates.slice(1)) {
      const s = c.contentScore + (boosts[c.pillar] || 0);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    return best.pillar;
  }
}
