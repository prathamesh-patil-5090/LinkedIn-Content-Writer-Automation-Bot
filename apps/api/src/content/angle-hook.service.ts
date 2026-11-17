import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AngleCandidateSchema,
  HookCandidateSchema,
  GENERIC_PHRASES,
  type AngleCandidate,
  type ContentFormat,
  type ContentPillar,
  type HookCandidate,
} from '@ldp/shared';
import { LlmService } from '../llm/llm.service';
import { firstPersonClaims } from './post-rules';
import * as fs from 'fs';
import * as path from 'path';

const AnglesSchema = z.object({
  angles: z.array(AngleCandidateSchema).min(1).max(8),
});

const HooksSchema = z.object({
  hooks: z.array(HookCandidateSchema).min(1).max(12),
});

const BANNED_HOOK_STARTS = [
  'excited to announce',
  "here's the thing",
  "let's dive in",
  'in today',
  'as a developer',
  'game changer',
  'thoughts?',
];

/** Formats that work as a third-person read of someone else's work. */
const CURATED_FORMATS: ContentFormat[] = [
  'technical_breakdown',
  'architecture_breakdown',
  'educational',
  'opinion',
  'technical_lesson',
];

@Injectable()
export class AngleHookService {
  private readonly log = new Logger(AngleHookService.name);

  constructor(private readonly llm: LlmService) {}

  async generateAngles(opts: {
    title: string;
    why?: string;
    pillar: ContentPillar;
    formatHint?: string;
    diversityNote?: string;
    /** True when the story is the author's own project (first person allowed). */
    ownWork?: boolean;
  }): Promise<{ angles: AngleCandidate[]; selected: AngleCandidate }> {
    const prompt = this.loadPrompt(
      'angle-v2.md',
      `Generate 5-6 LinkedIn content angles for a developer audience. When sourceKind is "curated" the story is someone else's work: every angle is a third-person read of it, never a story about the poster building it. Avoid CRag hype. Return JSON { angles: [{ label, angle, format, score, rationale }] }.`,
    );
    const { ownWork, ...input } = opts;
    let angles: AngleCandidate[];
    try {
      const result = await this.llm.chatJson<unknown>({
        model: process.env.LLM_CONTENT_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              ...input,
              sourceKind: ownWork ? 'own_work' : 'curated',
            }),
          },
        ],
      });
      angles = AnglesSchema.parse(result.data).angles;
    } catch (err) {
      this.log.warn(
        `Angle LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      angles = this.fallbackAngles(opts);
    }
    if (!ownWork) {
      // Someone else's work: no "how we built it" angles, no first-person formats.
      const honest = angles.filter((a) => !firstPersonClaims(a.angle).length);
      angles = (honest.length ? honest : this.fallbackAngles(opts)).map((a) => ({
        ...a,
        format:
          a.format && CURATED_FORMATS.includes(a.format)
            ? a.format
            : 'technical_breakdown',
      }));
    }
    angles = angles
      .map((a) => ({
        ...a,
        score: this.penalizeMarketing(a.angle, a.score),
      }))
      .sort((a, b) => b.score - a.score);
    return { angles, selected: angles[0] };
  }

  async generateHooks(opts: {
    title: string;
    angle: string;
    pillar: ContentPillar;
    avoidHooks?: string[];
    /** True when the story is the author's own project (first person allowed). */
    ownWork?: boolean;
  }): Promise<{ hooks: HookCandidate[]; selected: HookCandidate }> {
    const prompt = this.loadPrompt(
      'hook-v2.md',
      `Generate 5-10 LinkedIn hooks. When sourceKind is "curated" the story is someone else's work: state the pattern or trade-off, never claim an experience ("I built", "we", "our"). Ban cliché openers. No em dashes. Return JSON { hooks: [{ text, category, score }] }.`,
    );
    const { ownWork, ...input } = opts;
    let hooks: HookCandidate[];
    try {
      const result = await this.llm.chatJson<unknown>({
        model: process.env.LLM_CONTENT_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              ...input,
              sourceKind: ownWork ? 'own_work' : 'curated',
            }),
          },
        ],
      });
      hooks = HooksSchema.parse(result.data).hooks;
    } catch (err) {
      this.log.warn(
        `Hook LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      hooks = this.fallbackHooks(opts);
    }
    const avoid = new Set(
      (opts.avoidHooks || []).map((h) => h.toLowerCase().slice(0, 40)),
    );
    hooks = hooks
      .filter((h) => !this.isBannedHook(h.text))
      .filter((h) => ownWork || !firstPersonClaims(h.text).length)
      .filter((h) => !avoid.has(h.text.toLowerCase().slice(0, 40)))
      .map((h) => ({
        ...h,
        score: this.penalizeMarketing(h.text, h.score),
      }))
      .sort((a, b) => b.score - a.score);
    if (!hooks.length) hooks = this.fallbackHooks(opts);
    return { hooks, selected: hooks[0] };
  }

  private isBannedHook(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return (
      BANNED_HOOK_STARTS.some((b) => lower.startsWith(b)) ||
      GENERIC_PHRASES.some((p) => lower.includes(p))
    );
  }

  private penalizeMarketing(text: string, score: number): number {
    const lower = text.toLowerCase();
    let s = score;
    if (/crag|our product|sign up|waitlist|launching soon/i.test(lower)) {
      s -= 2.5;
    }
    if (GENERIC_PHRASES.some((p) => lower.includes(p))) s -= 2;
    return Math.max(0, Math.min(10, s));
  }

  private fallbackAngles(opts: {
    title: string;
    pillar: ContentPillar;
    formatHint?: string;
  }): AngleCandidate[] {
    const format = (opts.formatHint || 'engineering_story') as ContentFormat;
    return [
      {
        label: 'lesson',
        angle: `What builders should learn from: ${opts.title}`,
        format,
        score: 7.5,
        rationale: 'educational fallback',
      },
      {
        label: 'problem',
        angle: `The practical problem behind ${opts.title}`,
        format: 'technical_lesson',
        score: 7,
      },
      {
        label: 'tradeoff',
        angle: `Tradeoffs nobody mentions about ${opts.title}`,
        format: 'opinion',
        score: 6.5,
      },
    ];
  }

  private fallbackHooks(opts: {
    title: string;
    angle: string;
  }): HookCandidate[] {
    const short = opts.title.replace(/\s+/g, ' ').slice(0, 72);
    return [
      {
        text: `${short} looks small. The failure mode is not.`,
        category: 'curiosity',
        score: 7,
      },
      {
        text: `The trade-off inside ${short} is easy to miss.`,
        category: 'tradeoff',
        score: 7.2,
      },
      {
        text: `Most takes miss the boring part of ${short}.`,
        category: 'contrarian',
        score: 6.8,
      },
    ];
  }

  private loadPrompt(name: string, fallback: string): string {
    const p = path.resolve(process.cwd(), `../../prompts/${name}`);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return fallback;
    }
  }
}
