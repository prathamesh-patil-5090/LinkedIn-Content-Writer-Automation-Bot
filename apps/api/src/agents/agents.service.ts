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
      'openai/gpt-oss-20b',
    );
    const compact = stories.slice(0, 15).map((s) => ({
      title: s.title.slice(0, 140),
      link: s.link,
      source: s.source,
      blurb: s.summary.slice(0, 160),
    }));
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
          content: `Pick top 10 from these ${compact.length} stories:\n${JSON.stringify(compact)}`,
        },
      ],
    });
    const parsed = TopStoriesSchema.parse(result.data);
    return { ...result, data: parsed };
  }

  async rank(
    topStories: z.infer<typeof TopStoriesSchema>,
    used?: Array<{ title: string; link: string }>,
  ) {
    const model = this.model('LLM_RANK_MODEL', 'openai/gpt-oss-20b');
    const usedBlock =
      used && used.length
        ? `\n\nALREADY USED — never pick these titles or links:\n${JSON.stringify(used)}`
        : '';
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
The winner MUST be a story that has not been posted before (see already-used list).

Return ONLY valid JSON:
{"winner":{"title":"","link":"","why_it_matters":"","trend_score":1-10,"angle":"","prediction_reason":""},"runners_up":[{"title":"","reason_skipped":""}]}`,
        },
        {
          role: 'user',
          content: JSON.stringify(topStories) + usedBlock,
        },
      ],
    });
    return { ...result, data: RankSchema.parse(result.data) };
  }

  async writeDrafts(
    winner: z.infer<typeof RankSchema>['winner'],
    avoid?: { hooks: string[] },
  ) {
    const model = this.model('LLM_CONTENT_MODEL', 'openai/gpt-oss-20b');
    const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI builder).

Write TWO drafts for the winning story. Each draft body is exactly TWO long paragraphs (not bullets, not one-liners).

Styles:
1. operator_essay — what happened, why it matters to developers, what to do
2. journey_essay — same facts, but framed as a builder lesson / experience

Rules:
- Hook: one short sentence (stored in "hook", also used as the first line of the post)
- Body: EXACTLY two long paragraphs, separated by a blank line
- Each paragraph: 90–140 words of flowing prose (full sentences)
- Teach something concrete (upgrade, pin, migrate, patch, try a tool)
- Casual clear English. Sound like a person, not a news wire
- End the second paragraph with one question
- Max 2 hashtags after the second paragraph
- Do NOT invent fake metrics, clients, or personal stories
- Never use: synergy, disrupt, game-changer, revolutionary
- Forbidden: bullet lists, numbered lists, one sentence per line, "BRIEF and BIG" short-line layout
- This story has not been posted yet. Write a fresh take, not a recap of an earlier post.

Return ONLY JSON:
{"drafts":[{"style":"operator_essay","hook":"","body":""},{"style":"journey_essay","hook":"","body":""}]}`,
        },
        {
          role: 'user',
          content:
            JSON.stringify(winner) +
            (avoid?.hooks?.length
              ? `\n\nDo not reuse these previous hooks:\n${avoid.hooks
                  .slice(0, 12)
                  .map((h) => `- ${h}`)
                  .join('\n')}`
              : ''),
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
    avoidPosts?: string[];
  }) {
    const model = this.model('LLM_VOICE_MODEL', 'openai/gpt-oss-20b');
    const profile = this.voiceProfile();
    const samplesText = opts.voiceSamples
      .slice(0, 3)
      .map(
        (s, i) =>
          `--- SAMPLE ${i + 1}: ${s.title.slice(0, 80)} ---\n${s.body.slice(0, 700)}`,
      )
      .join('\n\n');

    const isRegen = Boolean(opts.feedback);
    const system = isRegen
      ? `You are regenerating a LinkedIn post for Prathamesh Patil after human rejection.

Produce a meaningfully different draft that addresses the feedback.

LAYOUT (non-negotiable):
- Line 1: short hook, then a blank line
- Then EXACTLY two long paragraphs of flowing prose (90–140 words each), separated by one blank line
- End the second paragraph with one question
- Max 2 hashtags after the paragraphs
- Casual, direct. No bullets. No one-sentence-per-line layout
- Do not invent fake metrics or personal stories

Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"...","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST of the two essay drafts into ONE final LinkedIn post that sounds like he wrote it.

LAYOUT (non-negotiable):
- Line 1: short hook, then a blank line
- Then EXACTLY two long paragraphs of flowing prose (90–140 words each)
- Separate the two paragraphs with one blank line
- Full sentences. No bullets, no numbered lists, no one-thought-per-line
- End the second paragraph with one question
- Max 2 hashtags after the second paragraph
- Stay under 3000 characters total (LinkedIn limit)

CRITICAL: Mimic the REAL writing samples (rhythm, honesty). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_essay|journey_essay","post_text":"...","hook":"...","image_prompt":"visual description for a 1024 square supporting image, no text overlay","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`;

    const result = await this.llm.chatJson({
      model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nDo not repeat these previous posts (new story, new argument, new hook):\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}`,
        },
      ],
    });

    const data = VoiceOutputSchema.parse(result.data);
    return { ...result, data };
  }
}
