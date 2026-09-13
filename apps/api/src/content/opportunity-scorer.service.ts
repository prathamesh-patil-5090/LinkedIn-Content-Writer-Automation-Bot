import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  OpportunityScoresSchema,
  weightedContentScore,
  type ContentPillar,
  type OpportunityScores,
} from '@ldp/shared';
import { LlmService } from '../llm/llm.service';
import { ContentConfigService } from './content-config.service';
import { PrismaService } from '../prisma/prisma.module';
import { PillarService } from './pillar.service';
import * as fs from 'fs';
import * as path from 'path';

const ScoreResponseSchema = z.object({
  scores: OpportunityScoresSchema,
  pillar: z
    .enum(['engineering', 'build_in_public', 'product', 'personal'])
    .optional(),
  format: z.string().optional(),
  rationale: z.string().optional(),
});

@Injectable()
export class OpportunityScorerService {
  private readonly log = new Logger(OpportunityScorerService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly config: ContentConfigService,
    private readonly prisma: PrismaService,
    private readonly pillars: PillarService,
  ) {}

  async scoreAndPersist(opts: {
    runId: string;
    sourceEventId?: string;
    title: string;
    link?: string;
    summary?: string;
    why?: string;
    angle?: string;
  }) {
    const scored = await this.scoreOpportunity(opts);
    const threshold = this.config.contentScoreThreshold();
    const below = scored.contentScore < threshold;
    const reasons = below
      ? [
          `contentScore ${scored.contentScore} < threshold ${threshold}`,
          ...(scored.rationale ? [scored.rationale] : []),
        ]
      : [];

    const row = await this.prisma.contentOpportunity.create({
      data: {
        sourceEventId: opts.sourceEventId,
        runId: opts.runId,
        title: opts.title.slice(0, 500),
        link: opts.link,
        pillar: scored.pillar,
        format: scored.format,
        contentScore: scored.contentScore,
        scoresJson: scored.scores,
        status: below ? 'rejected' : 'scored',
        rejectReasons: reasons,
      },
    });

    return { ...scored, opportunityId: row.id, rejected: below, reasons };
  }

  async scoreOpportunity(opts: {
    title: string;
    link?: string;
    summary?: string;
    why?: string;
    angle?: string;
  }): Promise<{
    scores: OpportunityScores;
    contentScore: number;
    pillar: ContentPillar;
    format?: string;
    rationale?: string;
  }> {
    const heuristic = this.heuristicScore(opts);
    const prompt = this.loadPrompt('event-scorer-v1.md');
    try {
      const result = await this.llm.chatJson<unknown>({
        model:
          process.env.LLM_RANK_MODEL ||
          process.env.LLM_CONTENT_MODEL ||
          'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              title: opts.title,
              link: opts.link,
              summary: opts.summary || opts.why,
              angle: opts.angle,
            }),
          },
        ],
      });
      const parsed = ScoreResponseSchema.parse(result.data);
      const scores = parsed.scores;
      const contentScore = weightedContentScore(scores);
      const pillar =
        parsed.pillar ||
        this.pillars.classify({
          title: opts.title,
          summary: opts.summary || opts.why,
          angle: opts.angle,
        });
      return {
        scores,
        contentScore,
        pillar,
        format: parsed.format,
        rationale: parsed.rationale,
      };
    } catch (err) {
      this.log.warn(
        `Opportunity scorer LLM failed, using heuristic: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return heuristic;
    }
  }

  heuristicScore(opts: {
    title: string;
    summary?: string;
    why?: string;
    angle?: string;
  }) {
    const text = `${opts.title} ${opts.summary || ''} ${opts.why || ''} ${opts.angle || ''}`.toLowerCase();
    const hasTech =
      /typescript|javascript|react|next\.?js|node|api|rag|llm|docker|postgres|prisma|nestjs/i.test(
        text,
      );
    const hasStory = /bug|mistake|failed|shipped|built|migrat|refactor|lesson/i.test(
      text,
    );
    const hasEdu = /how|guide|learn|tip|pattern|why/i.test(text);
    const novelty = hasTech ? 7 : 5;
    const scores: OpportunityScores = {
      technicalNovelty: novelty,
      educationalValue: hasEdu ? 8 : 6,
      practicalValue: hasTech ? 7 : 5,
      personalExperience: hasStory ? 7 : 4,
      problemSeverity: /cve|outage|breach|critical|broke/i.test(text) ? 8 : 5,
      storyPotential: hasStory ? 8 : 5,
      discussionPotential: 6,
      visualPotential: 5,
      audienceRelevance: hasTech ? 8 : 5,
      originality: 6,
    };
    return {
      scores,
      contentScore: weightedContentScore(scores),
      pillar: this.pillars.classify(opts),
      format: hasStory ? 'engineering_story' : 'educational',
      rationale: 'heuristic fallback',
    };
  }

  private loadPrompt(name: string): string {
    const p = path.resolve(process.cwd(), `../../prompts/${name}`);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return `Score this developer content opportunity 0-10 on: technicalNovelty, educationalValue, practicalValue, personalExperience, problemSeverity, storyPotential, discussionPotential, visualPotential, audienceRelevance, originality. Return JSON { scores, pillar, format, rationale }. Prefer engineering / build_in_public over marketing fluff. Penalize pure CRag product marketing.`;
    }
  }
}
