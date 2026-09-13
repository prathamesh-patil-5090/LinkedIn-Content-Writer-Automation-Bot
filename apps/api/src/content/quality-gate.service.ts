import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  GENERIC_PHRASES,
  QualityScoresSchema,
  type AutoDecision,
  type QualityScores,
} from '@ldp/shared';
import { LlmService } from '../llm/llm.service';
import { ContentConfigService } from './content-config.service';
import { UsedIndex } from '../pipeline/uniqueness';
import * as fs from 'fs';
import * as path from 'path';

const QcSchema = z.object({
  scores: QualityScoresSchema.partial().optional(),
  pass: z.boolean().optional(),
  reasons: z.array(z.string()).optional(),
  feedback: z.string().optional(),
});

/** Positive dimensions — higher is better. */
const POSITIVE_KEYS: Array<keyof QualityScores> = [
  'technicalAccuracy',
  'authenticity',
  'hook',
  'educationalValue',
  'originality',
  'readability',
  'storytelling',
  'relevance',
  'factualGrounding',
];

/** Penalty dimensions — higher is worse. */
const PENALTY_KEYS: Array<keyof QualityScores> = [
  'aiGenericness',
  'repetition',
];

@Injectable()
export class QualityGateService {
  private readonly log = new Logger(QualityGateService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly config: ContentConfigService,
  ) {}

  async evaluate(opts: {
    postText: string;
    hook: string;
    sourceTitle?: string;
    sourceLink?: string;
    pillar?: string;
    used?: UsedIndex;
    regenerationCount?: number;
  }): Promise<AutoDecision & { feedback?: string; scores: QualityScores }> {
    const heuristic = this.heuristicEvaluate(opts);
    let llmFeedback: string | undefined;
    let llmPass: boolean | undefined;
    let llmReasons: string[] = [];

    try {
      const prompt = this.loadPrompt();
      const result = await this.llm.chatJson<unknown>({
        model:
          process.env.LLM_VOICE_MODEL ||
          process.env.LLM_CONTENT_MODEL ||
          'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              hook: opts.hook,
              post_text: opts.postText.slice(0, 3500),
              source_title: opts.sourceTitle,
              pillar: opts.pillar,
            }),
          },
        ],
      });
      const parsed = QcSchema.parse(result.data);
      llmPass = parsed.pass;
      llmReasons = parsed.reasons || [];
      llmFeedback = parsed.feedback;

      if (parsed.scores) {
        heuristic.scores = this.blendScores(
          heuristic.scores,
          parsed.scores as Partial<QualityScores>,
        );
      }
    } catch (err) {
      this.log.warn(
        `QC LLM soft-fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const qualityScore = this.compositeQuality(heuristic.scores);
    const decision = this.decide({
      scores: heuristic.scores,
      qualityScore,
      reasons: heuristic.reasons,
      llmReasons,
      llmPass,
      regenerationCount: opts.regenerationCount || 0,
      used: opts.used,
      hook: opts.hook,
      postText: opts.postText,
    });

    return {
      ...decision,
      feedback:
        llmFeedback ||
        heuristic.feedback ||
        'Rewrite with a concrete builder lesson, first-person detail, and no clichés or invented metrics.',
      scores: heuristic.scores,
    };
  }

  /**
   * Heuristics own the floor/ceiling so a harsh LLM cannot zero out a passable post.
   * Positive dims: 70% heuristic + 30% LLM, floored at heuristic - 2.
   * Penalty dims: 70% heuristic + 30% LLM, capped at heuristic + 2.
   */
  blendScores(
    base: QualityScores,
    llm: Partial<QualityScores>,
  ): QualityScores {
    const out = { ...base };
    for (const key of POSITIVE_KEYS) {
      const lv = llm[key];
      if (typeof lv !== 'number' || !Number.isFinite(lv)) continue;
      const blended = base[key] * 0.7 + clamp01to10(lv) * 0.3;
      out[key] = clamp01to10(Math.max(base[key] - 2, blended));
    }
    for (const key of PENALTY_KEYS) {
      const lv = llm[key];
      if (typeof lv !== 'number' || !Number.isFinite(lv)) continue;
      const blended = base[key] * 0.7 + clamp01to10(lv) * 0.3;
      out[key] = clamp01to10(Math.min(base[key] + 2, blended));
    }
    return out;
  }

  private decide(opts: {
    scores: QualityScores;
    qualityScore: number;
    reasons: string[];
    llmReasons: string[];
    llmPass?: boolean;
    regenerationCount: number;
    used?: UsedIndex;
    hook: string;
    postText: string;
  }): AutoDecision {
    const reasons = [...opts.reasons];
    const maxRegen = this.config.maxRegenerationAttempts();
    const qThresh = this.config.qualityScoreThreshold();
    const authThresh = this.config.authenticityThreshold();
    const genericMax = this.config.aiGenericnessMax();

    let fails = 0;

    if (opts.scores.authenticity < authThresh) {
      reasons.push(
        `authenticity ${opts.scores.authenticity} < ${authThresh}`,
      );
      fails += 1;
    }
    if (opts.scores.aiGenericness > genericMax) {
      reasons.push(
        `aiGenericness ${opts.scores.aiGenericness} > ${genericMax}`,
      );
      fails += 1;
    }
    if (opts.qualityScore < qThresh) {
      reasons.push(`qualityScore ${opts.qualityScore} < ${qThresh}`);
      fails += 1;
    }
    if (opts.used?.matchesHook(opts.hook)) {
      reasons.push('hook too similar to recent posts');
      fails += 2; // hard fail signal
    }
    if (opts.scores.factualGrounding < 4) {
      reasons.push('weak factual grounding / invented metrics risk');
      fails += 1;
    }

    // LLM veto alone is not enough — only add weight when heuristics already shaky
    // or when quality is clearly below threshold.
    if (opts.llmPass === false && fails >= 1) {
      for (const r of opts.llmReasons.slice(0, 3)) {
        if (r && !reasons.includes(r)) reasons.push(r);
      }
      fails += 1;
    } else if (opts.llmPass === false && fails === 0) {
      this.log.log(
        'QC LLM suggested fail but heuristics passed — keeping advisory only',
      );
      // Soft note only; do not regenerate solely on LLM opinion
      if (opts.llmReasons[0]) {
        reasons.push(`llm-note: ${opts.llmReasons[0]}`);
      }
    }

    let decision: AutoDecision['decision'] = 'approved';
    if (fails >= 1) decision = 'regenerate';

    if (decision === 'regenerate' && opts.regenerationCount >= maxRegen) {
      decision = 'rejected';
      reasons.push(`max regenerations (${maxRegen}) exhausted`);
    }

    const uniqueReasons = [...new Set(reasons)].filter(Boolean);
    if (decision === 'approved') {
      return {
        decision,
        reasons: ['passed quality gate'],
        qualityScore: opts.qualityScore,
        authenticityScore: opts.scores.authenticity,
        aiGenericnessScore: opts.scores.aiGenericness,
        repetitionScore: opts.scores.repetition,
        regenerationCount: opts.regenerationCount,
      };
    }

    return {
      decision,
      reasons: uniqueReasons,
      qualityScore: opts.qualityScore,
      authenticityScore: opts.scores.authenticity,
      aiGenericnessScore: opts.scores.aiGenericness,
      repetitionScore: opts.scores.repetition,
      regenerationCount: opts.regenerationCount,
    };
  }

  heuristicEvaluate(opts: {
    postText: string;
    hook: string;
    sourceTitle?: string;
  }): {
    scores: QualityScores;
    reasons: string[];
    feedback?: string;
    decision: AutoDecision['decision'];
  } {
    const text = opts.postText || '';
    const lower = text.toLowerCase();
    const hookLower = (opts.hook || '').toLowerCase();
    const reasons: string[] = [];

    // Strip unicode bold/italic for phrase checks
    const plain = fromPretty(lower);
    const hookPlain = fromPretty(hookLower);

    let genericHits = 0;
    for (const p of GENERIC_PHRASES) {
      if (plain.includes(p) || hookPlain.includes(p)) genericHits += 1;
    }
    const aiGenericness = Math.min(10, genericHits * 2.5);
    if (genericHits) reasons.push(`generic phrases: ${genericHits}`);

    const inventedMetrics =
      /\b\d{2,3}%/.test(text) &&
      !/\b(benchmark|measured|logged|profiled|traced|from (the )?logs?|in (prod|production))\b/i.test(
        text,
      );
    const factualGrounding = inventedMetrics ? 3 : 7.5;
    if (inventedMetrics) reasons.push('suspected ungrounded percentage claim');

    const len = text.length;
    const readability = len >= 350 && len <= 2400 ? 8 : len < 220 ? 4.5 : 6.5;
    const hasStructure = (text.match(/\n/g) || []).length >= 2;
    const storytelling = hasStructure ? 7.5 : 5.5;
    const hasVoice = /\b(i|we|my|our|i'm|i’ve|i've)\b/i.test(plain);
    const authenticity =
      hasVoice && genericHits === 0 ? 7.8 : hasVoice ? 6.5 : 5.8;
    const hookScore =
      opts.hook.length >= 12 && opts.hook.length <= 140 && genericHits === 0
        ? 8
        : opts.hook.length >= 8
          ? 6.5
          : 5;
    const repetition = this.localRepetition(plain);

    const scores: QualityScores = {
      technicalAccuracy: 7,
      authenticity,
      hook: hookScore,
      educationalValue: /how|why|because|lesson|fix|pattern|instead|tradeoff/i.test(
        plain,
      )
        ? 7.5
        : 6.2,
      originality: Math.max(4, 8 - genericHits),
      readability,
      storytelling,
      relevance: 7,
      aiGenericness,
      repetition,
      factualGrounding,
    };

    return {
      scores,
      reasons,
      decision: 'approved',
      feedback:
        genericHits || inventedMetrics
          ? 'Rewrite with concrete engineering detail. Drop clichés and unverified percentages. First-person builder voice.'
          : undefined,
    };
  }

  compositeQuality(scores: QualityScores): number {
    const positive =
      scores.technicalAccuracy * 0.1 +
      scores.authenticity * 0.15 +
      scores.hook * 0.1 +
      scores.educationalValue * 0.15 +
      scores.originality * 0.1 +
      scores.readability * 0.1 +
      scores.storytelling * 0.1 +
      scores.relevance * 0.05 +
      scores.factualGrounding * 0.15;
    const penalty =
      (scores.aiGenericness / 10) * 1.5 + (scores.repetition / 10) * 1.0;
    return Math.round(Math.max(0, Math.min(10, positive - penalty)) * 100) / 100;
  }

  private localRepetition(text: string): number {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4);
    if (words.length < 20) return 3;
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const max = Math.max(...freq.values());
    const ratio = max / words.length;
    return Math.min(10, Math.round(ratio * 40));
  }

  private loadPrompt(): string {
    const p = path.resolve(process.cwd(), '../../prompts/qc-v1.md');
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return `Quality-check a LinkedIn post for developers. Be calibrated: a solid builder post should score authenticity 6-8, aiGenericness 1-3. Only fail on clear clichés, invented metrics, or empty marketing. Return JSON { scores, pass, reasons, feedback }.`;
    }
  }
}

function clamp01to10(n: number): number {
  return Math.max(0, Math.min(10, n));
}

/** Rough strip of common unicode letter variants used in LinkedIn formatting. */
function fromPretty(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}
