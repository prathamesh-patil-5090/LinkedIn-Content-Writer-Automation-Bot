import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { CollectedStory } from '../news/news.service';
import { cleanStoryBlurb, isHnMetadata } from '../news/hn-item';
import { VoiceOutputSchema } from '@ldp/shared';
import { normalizeBucket, type ContentType } from '@ldp/shared';
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
  private readonly log = new Logger(AgentsService.name);

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

  async research(stories: CollectedStory[], required?: ContentType) {
    const model = this.model(
      'LLM_RESEARCH_MODEL',
      'openai/gpt-oss-20b',
    );
    const compact = stories.slice(0, 18).map((s) => ({
      title: s.title.slice(0, 140),
      link: s.link,
      source: s.source,
      blurb: cleanStoryBlurb(s.title, s.summary).slice(0, 160),
    }));
    const mixRule = required
      ? `This run's content type is "${required}". Label every story with a honest angle (js-lib, ai-devtools, security-bug, or dev-tool). Prefer stories that fit "${required}". Still return a mixed top 8 so we have fallbacks.`
      : `Return a MIXED top 8: at least 3 js-lib, 2 ai-devtools, at most 2 security-bug.`;
    try {
      const result = await this.llm.chatJson<z.infer<typeof TopStoriesSchema>>({
        model,
        messages: [
          {
            role: 'system',
            content: `You pick LinkedIn news for a JavaScript / AI-builder developer.

Pick TOP 8 stories:
1. JS/TS libraries, npm, React/Next/Node (angle must be exactly "js-lib")
2. AI coding tools / LLM SDKs (angle must be exactly "ai-devtools")
3. JS/Node CVEs and supply-chain bugs (angle must be exactly "security-bug")
4. Other concrete dev tools (angle must be exactly "dev-tool")

${mixRule}

Reject podcasts, funding, politics, and generic vuln roundups.

why_it_matters: one short sentence, what a developer should DO.

Return ONLY valid JSON. trend_score is a single number 1 to 10. Example:
{"top_stories":[{"rank":1,"title":"Node 22 ships","link":"https://example.com","why_it_matters":"Upgrade Node for the new baseline.","trend_score":8,"angle":"js-lib"}]}`,
          },
          {
            role: 'user',
            content: `Pick top 8 from these ${compact.length} stories:\n${JSON.stringify(compact)}`,
          },
        ],
      });
      const parsed = TopStoriesSchema.parse(result.data);
      if (parsed.top_stories.length) return { ...result, data: parsed };
    } catch (err) {
      this.log.warn(
        `Research LLM failed, using heuristic list: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return {
      data: this.heuristicTop(stories, required),
      raw: '',
      model: 'heuristic',
      latencyMs: 0,
    };
  }

  async rank(
    topStories: z.infer<typeof TopStoriesSchema>,
    used?: Array<{ title: string; link: string }>,
    required?: ContentType,
  ) {
    const model = this.model('LLM_RANK_MODEL', 'openai/gpt-oss-20b');
    const usedBlock =
      used && used.length
        ? `\n\nALREADY USED — never pick these titles or links:\n${JSON.stringify(used)}`
        : '';
    const typeRule = required
      ? `Required content type for this slot: "${required}".
- security-bug: pick a JS/Node-relevant CVE/supply-chain story only
- js-lib: a library/framework/npm/Node/React release — NEVER a CVE
- ai-devtools: an AI coding tool / LLM SDK — NEVER a CVE
- howto / architecture: pick a js-lib, ai-devtools, or dev-tool story (not a CVE) that can teach a pattern or tradeoff
If the required bucket is empty, fall back js-lib → ai-devtools → dev-tool. Never fill a non-security slot with a CVE.`
      : `Prefer unused js-lib or ai-devtools over another CVE if several security stories already sit in the list.`;
    try {
      const result = await this.llm.chatJson<z.infer<typeof RankSchema>>({
        model,
        messages: [
          {
            role: 'system',
            content: `You rank ONE LinkedIn story for a JavaScript + AI-tools developer.

${typeRule}

Reject podcasts, funding headlines, vague essays, and generic vuln roundups with no JS action.
The winner MUST be a story that has not been posted before (see already-used list).

Return ONLY valid JSON. trend_score is a single number. Example:
{"winner":{"title":"Node 22 ships","link":"https://example.com","why_it_matters":"Upgrade Node.","trend_score":8,"angle":"js-lib","prediction_reason":"Fresh JS release"},"runners_up":[{"title":"Other","reason_skipped":"weaker takeaway"}]}`,
          },
          {
            role: 'user',
            content: JSON.stringify(topStories) + usedBlock,
          },
        ],
      });
      return { ...result, data: RankSchema.parse(result.data) };
    } catch (err) {
      this.log.warn(
        `Rank LLM failed, using first unused story: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const winner = topStories.top_stories[0];
      if (!winner) throw err;
      return {
        data: {
          winner: {
            title: winner.title,
            link: winner.link,
            why_it_matters: winner.why_it_matters,
            trend_score: winner.trend_score,
            angle: winner.angle,
            prediction_reason: 'heuristic fallback',
          },
          runners_up: topStories.top_stories.slice(1, 4).map((s) => ({
            title: s.title,
            reason_skipped: 'heuristic',
          })),
        },
        raw: '',
        model: 'heuristic',
        latencyMs: 0,
      };
    }
  }

  private heuristicTop(
    stories: CollectedStory[],
    required?: ContentType,
  ): z.infer<typeof TopStoriesSchema> {
    const labeled = stories.map((s) => {
      const blob = `${s.title} ${s.summary} ${s.source}`;
      const angle = normalizeBucket(blob);
      return {
        title: s.title,
        link: s.link,
        why_it_matters: cleanStoryBlurb(s.title, s.summary),
        trend_score: Math.min(10, Math.max(1, Math.round((s.relevance ?? 4) / 2))),
        angle,
      };
    });

    const want = required
      ? required === 'security-bug'
        ? ['security-bug']
        : required === 'js-lib'
          ? ['js-lib']
          : required === 'ai-devtools'
            ? ['ai-devtools']
            : ['js-lib', 'ai-devtools', 'dev-tool']
      : ['js-lib', 'ai-devtools', 'dev-tool', 'security-bug'];

    const picked: typeof labeled = [];
    const used = new Set<string>();
    for (const angle of want) {
      for (const s of labeled) {
        if (s.angle !== angle || used.has(s.link)) continue;
        if (angle === 'security-bug' && picked.filter((p) => p.angle === angle).length >= 2) {
          continue;
        }
        used.add(s.link);
        picked.push(s);
        if (picked.length >= 8) break;
      }
      if (picked.length >= 8) break;
    }
    if (picked.length < 8) {
      for (const s of labeled) {
        if (used.has(s.link)) continue;
        used.add(s.link);
        picked.push(s);
        if (picked.length >= 8) break;
      }
    }

    return {
      top_stories: picked.map((s, i) => ({ ...s, rank: i + 1 })),
    };
  }

  async writeDrafts(
    winner: z.infer<typeof RankSchema>['winner'],
    avoid?: { hooks: string[] },
    contentType?: ContentType,
  ) {
    const model = this.model('LLM_CONTENT_MODEL', 'openai/gpt-oss-20b');
    const styles =
      contentType === 'howto'
        ? `Styles:
1. teach_essay — walk through a concrete pattern a JS/AI builder can try this week, using the story as the hook
2. operator_essay — what happened, why it matters, what to do`
        : contentType === 'architecture'
          ? `Styles:
1. tradeoff_essay — the design choice / tradeoff this story exposes, and when you'd pick which side
2. journey_essay — same facts as a builder lesson`
          : `Styles:
1. operator_essay — what happened, why it matters to developers, what to do
2. journey_essay — same facts, but framed as a builder lesson / experience`;
    const styleJson =
      contentType === 'howto'
        ? '{"drafts":[{"style":"teach_essay","hook":"","body":""},{"style":"operator_essay","hook":"","body":""}]}'
        : contentType === 'architecture'
          ? '{"drafts":[{"style":"tradeoff_essay","hook":"","body":""},{"style":"journey_essay","hook":"","body":""}]}'
          : '{"drafts":[{"style":"operator_essay","hook":"","body":""},{"style":"journey_essay","hook":"","body":""}]}';
    try {
    const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI builder). Do not use <think> tags. Raw JSON only.

Write TWO LinkedIn drafts for the winning story. Length matches a ~240 word operator post.

${styles}

Rules:
- Hook: one short headline about THIS story (name the tool / CVE / release)
- Then EXACTLY two long paragraphs (about 100–120 words each), separated by a blank line
- Paragraph 1: what shipped / why it matters, with specific names (engine, API, version)
- Paragraph 2: what to do this week (upgrade, pin, swap a client, add a CI check)
- End with one question
- 5–8 hashtags after the question
- One dry aside is fine. Not a joke dump
- NEVER paste "Article URL", "Comments URL", Points, or HN score dumps
- Do NOT invent fake metrics or personal stories
- Never use: synergy, disrupt, game-changer, "here's the thing", "let's dive in"

Return ONLY JSON:
${styleJson}`,
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
    } catch (err) {
      this.log.warn(
        `Content LLM failed, using template drafts: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return {
        data: this.templateDrafts(winner),
        raw: '',
        model: 'heuristic',
        latencyMs: 0,
      };
    }
  }

  private storyFacts(winner: z.infer<typeof RankSchema>['winner']) {
    const title = winner.title.replace(/\s+/g, ' ').trim();
    const why = isHnMetadata(winner.why_it_matters || '')
      ? ''
      : cleanStoryBlurb(title, winner.why_it_matters || '');
    return { title, why };
  }

  private templateDrafts(
    winner: z.infer<typeof RankSchema>['winner'],
  ): z.infer<typeof ContentSchema> {
    const { hook, body } = this.storyPost(winner);
    return {
      drafts: [
        { style: 'operator_essay', hook, body },
        { style: 'journey_essay', hook, body },
      ],
    };
  }

  private storyPost(winner: z.infer<typeof RankSchema>['winner']) {
    const { title, why } = this.storyFacts(winner);
    const hook = title.length > 88 ? `${title.slice(0, 85).trim()}…` : title;
    const take = why && why !== `${title}.` ? why : '';
    const host = (() => {
      try {
        return new URL(winner.link).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    const p1 = [
      take || `${title} is the thing worth an hour this week, not a screenshot of the HN thread.`,
      host.includes('github')
        ? `Open the repo and read the README before you quote a tweet. The useful part is usually one command, one lockfile change, or one CI check — not the star count.`
        : `Read the source notes, not the scorecard. The useful part is usually one command, one lockfile change, or one CI check.`,
      `Name what actually moved: the API, the version, the failure mode. If you cannot name it, you are not ready to post about it either.`,
    ].join(' ');
    const p2 = [
      `If this lands in your stack, do the boring pass: pin the version, run the tests you already have, and write down the first error.`,
      `*Do that before the hot take.*`,
      `Add a note in CI so the next person does not rediscover it at 1am. Then tell the team what you changed, not that you "looked into it."`,
      `What are you actually shipping this week?`,
    ].join(' ');
    return { hook, body: `${p1}\n\n${p2}` };
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

LAYOUT (same length as a ~240 word Node release post):
- Line 1: **bold hook**, then a blank line
- Then EXACTLY two long paragraphs (~100–120 words each), blank line between them
- Para 1 = what shipped / why it matters. Para 2 = what to do this week
- End with one question, then 5–8 hashtags
- One *italic* aside
- NEVER copy Article URL / Comments URL / Points / HN metadata
- Do not invent fake metrics or personal stories

Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"...","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST of the two essay drafts into ONE final LinkedIn post that sounds like he wrote it.

LAYOUT (target ~220–280 words, like a Node 22 upgrade post):
- Line 1: **bold hook** naming the tool/CVE/release, then a blank line
- Then EXACTLY two long paragraphs (~100–120 words each) of flowing prose
- Separate the two paragraphs with one blank line
- Para 1: concrete facts (versions, engines, APIs). Para 2: upgrade / pin / CI steps
- End with one question, then 5–8 hashtags
- Stay under 3000 characters
- NEVER copy Article URL, Comments URL, Points, or "# Comments"

ANTI-AI VOICE:
- Sound slightly amused or annoyed, like you're telling a coworker
- One dry / sarcastic aside per post (*yes, including the migrate-you-swore-you'd-do*)
- Specific: name the tool, the version, the pain. No "in today's landscape"
- Forbidden: "here's the thing", "let's dive in", "it's worth noting", "as developers we", game-changer

MARKDOWN (we convert it to LinkedIn Unicode):
- Wrap the hook line in **double asterisks**
- Bold 1–2 key phrases (version, CVE, tool name)
- Italicize one aside with *single asterisks*
- Never wrap hashtags or URLs

CRITICAL: Mimic the REAL writing samples (rhythm, honesty). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_essay|journey_essay","post_text":"...","hook":"...","image_prompt":"visual description for a 1024 square supporting image, no text overlay","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`;

    try {
    const result = await this.llm.chatJson({
      model,
      messages: [
        { role: 'system', content: `${system}\n\nDo not use <think> tags. Return raw JSON only.` },
        {
          role: 'user',
          content: `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nDo not repeat these previous posts (new story, new argument, new hook):\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}`,
        },
      ],
    });

    const data = VoiceOutputSchema.parse(result.data);
    return { ...result, data };
    } catch (err) {
      this.log.warn(
        `Voice LLM failed, using template post: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const { hook, body } = this.storyPost(opts.winner);
      const post_text = `**${hook}**\n\n${body}`;
      return {
        data: VoiceOutputSchema.parse({
          chosen_style: 'operator_essay',
          post_text,
          hook,
          image_prompt: `Editorial card about ${hook}`,
          hashtags: ['#BuildInPublic', '#LearnInPublic', '#JavaScript'],
          source_title: opts.winner.title,
          source_link: opts.winner.link,
        }),
        raw: '',
        model: 'heuristic',
        latencyMs: 0,
      };
    }
  }
}
