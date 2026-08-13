import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { CollectedStory } from '../news/news.service';
import { VoiceOutputSchema } from '@ldp/shared';
import * as fs from 'fs';
import * as path from 'path';

const TopStoriesSchema = z.object({
  top_stories: z.array(
    z.object({
      rank: z.number().optional(),
      title: z.string(),
      link: z.string(),
      why_it_matters: z.string(),
      trend_score: z.number(),
      angle: z.string(),
    }),
  ),
});

const RankSchema = z.object({
  winner: z.object({
    title: z.string(),
    link: z.string(),
    why_it_matters: z.string(),
    trend_score: z.number().optional(),
    angle: z.string(),
    prediction_reason: z.string().optional(),
  }),
  runners_up: z
    .array(z.object({ title: z.string(), reason_skipped: z.string() }))
    .optional(),
});

const ContentSchema = z.object({
  drafts: z.array(
    z.object({
      style: z.string(),
      hook: z.string(),
      body: z.string(),
    }),
  ),
});

@Injectable()
export class AgentsService {
  constructor(
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  private model(key: string, fallback: string) {
    return this.config.get<string>(key) || fallback;
  }

  private voiceProfile(): string {
    const p = path.resolve(process.cwd(), '../../prompts/voice-profile.md');
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return 'Write like Prathamesh Patil: pragmatic developer, build-in-public, honest, casual.';
    }
  }

  async research(stories: CollectedStory[]) {
    const model = this.model(
      'LLM_RESEARCH_MODEL',
      'llama-3.3-70b-versatile',
    );
    const result = await this.llm.chatJson<z.infer<typeof TopStoriesSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a research analyst picking LinkedIn news for a JavaScript / AI-builder developer (Prathamesh Patil).

Return TOP 10 stories ONLY from these buckets (priority order):
1. JavaScript/TypeScript libraries, npm packages, React/Next/Node tooling, framework releases
2. New AI tools for developers (coding agents, Copilot/Claude/Cursor-style tools, RAG/LLM SDKs, AI APIs for builders)
3. Security: new bugs, CVEs, exploits, supply-chain attacks, patches developers should know
4. Other concrete developer tooling (APIs, CLIs, open-source releases) if space remains

HARD REJECT:
- Podcasts / "listen to this episode" (unless the title is itself a concrete release/CVE)
- Funding, valuations, acquisitions with no builder takeaway
- Non-JS language cheerleading with no library/tool news (e.g. pure "Go is great" essays)
- Celebrity AI hype, consumer gadgets, crypto speculation, politics

why_it_matters must say what a JS/AI developer can DO with this (upgrade, migrate, patch, try a tool).

Return ONLY valid JSON:
{"top_stories":[{"rank":1,"title":"","link":"","why_it_matters":"","trend_score":1-10,"angle":"js-lib|ai-devtools|security-bug|dev-tool"}]}`,
        },
        {
          role: 'user',
          content: `Story count: ${stories.length}\n\nStories JSON:\n${JSON.stringify(stories)}`,
        },
      ],
    });
    const parsed = TopStoriesSchema.parse(result.data);
    return { ...result, data: parsed };
  }

  async rank(topStories: z.infer<typeof TopStoriesSchema>) {
    const model = this.model('LLM_RANK_MODEL', 'openai/gpt-oss-20b');
    const result = await this.llm.chatJson<z.infer<typeof RankSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You rank ONE LinkedIn story for a JavaScript + AI-tools developer.

Prefer in this order:
1. New/updated JS/TS libraries or npm ecosystem news
2. New AI developer tools (coding agents, LLM SDKs, builder workflows)
3. Fresh security bugs / CVEs / supply-chain issues developers should act on
4. Other sharp developer-tooling news

Reject podcasts, funding headlines, and vague essays.

Return ONLY valid JSON:
{"winner":{"title":"","link":"","why_it_matters":"","trend_score":1-10,"angle":"","prediction_reason":""},"runners_up":[{"title":"","reason_skipped":""}]}`,
        },
        {
          role: 'user',
          content: JSON.stringify(topStories),
        },
      ],
    });
    return { ...result, data: RankSchema.parse(result.data) };
  }

  async writeDrafts(winner: z.infer<typeof RankSchema>['winner']) {
    const model = this.model('LLM_CONTENT_MODEL', 'llama-3.3-70b-versatile');
    const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You write LinkedIn draft angles for Prathamesh Patil.

Write THREE drafts for the winning story. Sound like a real builder — not a news rewriter.

Styles:
1. operator_playbook — how builders should act on this
2. journey_lesson — personal builder journey framing
3. product_insight — product/SaaS/AI/tooling angle

Rules:
- Sharp hook in first line
- Teach something specific
- Short paragraphs, LinkedIn line breaks
- Casual clear English
- Max 3 hashtags at end
- 180–280 words
- Do NOT invent fake metrics or clients
- Never use: synergy, disrupt, game-changer, revolutionary

Return ONLY JSON:
{"drafts":[{"style":"operator_playbook","hook":"","body":""},{"style":"journey_lesson","hook":"","body":""},{"style":"product_insight","hook":"","body":""}]}`,
        },
        {
          role: 'user',
          content: JSON.stringify(winner),
        },
      ],
    });
    return { ...result, data: ContentSchema.parse(result.data) };
  }

  async applyVoice(opts: {
    drafts: z.infer<typeof ContentSchema>;
    winner: z.infer<typeof RankSchema>['winner'];
    voiceSamples: Array<{ title: string; body: string }>;
    feedback?: string;
  }) {
    const model = this.model('LLM_VOICE_MODEL', 'llama-3.3-70b-versatile');
    const profile = this.voiceProfile();
    const samplesText = opts.voiceSamples
      .map((s, i) => `--- SAMPLE ${i + 1}: ${s.title} ---\n${s.body}`)
      .join('\n\n');

    const isRegen = Boolean(opts.feedback);
    const system = isRegen
      ? `You are regenerating a LinkedIn post for Prathamesh Patil after human rejection.

Produce a meaningfully different draft that addresses the feedback, mimicking his real writing style from the samples.
- Casual, direct, build-in-public
- Short punchy sentences + line breaks
- Admit tradeoffs / mistakes when natural
- No corporate fluff, no fake metrics
- 180–280 words, max 3 hashtags

Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"...","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST of the three drafts into ONE final LinkedIn post that sounds like he wrote it.

CRITICAL: Mimic the REAL writing samples (rhythm, sentence length, structure). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_playbook|journey_lesson|product_insight","post_text":"...","hook":"...","image_prompt":"visual description for a 1024 square supporting image, no text overlay","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`;

    const result = await this.llm.chatJson({
      model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nFeedback:\n${opts.feedback || '(none)'}`,
        },
      ],
    });

    const data = VoiceOutputSchema.parse(result.data);
    return { ...result, data };
  }
}
