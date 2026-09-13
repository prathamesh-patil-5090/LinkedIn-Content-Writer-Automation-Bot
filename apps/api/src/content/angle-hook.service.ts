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
  }): Promise<{ angles: AngleCandidate[]; selected: AngleCandidate }> {
    const prompt = this.loadPrompt(
      'angle-v1.md',
      `Generate 5-6 LinkedIn content angles for a developer audience. Prefer concrete engineering stories over product marketing. Avoid CRag hype. Return JSON { angles: [{ label, angle, format, score, rationale }] }.`,
    );
    let angles: AngleCandidate[];
    try {
      const result = await this.llm.chatJson<unknown>({
        model: process.env.LLM_CONTENT_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(opts) },
        ],
      });
      angles = AnglesSchema.parse(result.data).angles;
    } catch (err) {
      this.log.warn(
        `Angle LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      angles = this.fallbackAngles(opts);
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
  }): Promise<{ hooks: HookCandidate[]; selected: HookCandidate }> {
    const prompt = this.loadPrompt(
      'hook-v1.md',
      `Generate 5-10 LinkedIn hooks. Categories: curiosity, contrarian, story, result, mistake, lesson. Ban cliché openers. No em dashes. Return JSON { hooks: [{ text, category, score }] }.`,
    );
    let hooks: HookCandidate[];
    try {
      const result = await this.llm.chatJson<unknown>({
        model: process.env.LLM_CONTENT_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(opts) },
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
        text: `I almost shipped the wrong fix for this.`,
        category: 'mistake',
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
