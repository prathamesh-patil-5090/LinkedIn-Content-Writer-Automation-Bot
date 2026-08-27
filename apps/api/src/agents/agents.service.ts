import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { CollectedStory } from '../news/news.service';
import {
  VoiceOutputSchema,
  normalizeBucket,
  polishLinkedInPostText,
  formatLinkedInText,
  applyLinkedInMarkdown,
  fromUnicodeVariant,
} from '@ldp/shared';
import type { ContentType, StoryBucket } from '@ldp/shared';
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

  /** Keyword rank when Groq JSON mode flakes — keeps Generate usable. */
  researchHeuristic(
    stories: CollectedStory[],
    required?: ContentType,
  ): z.infer<typeof TopStoriesSchema> {
    const scored = stories
      .map((s) => {
        const angle = normalizeBucket(`${s.title} ${s.summary} ${s.source}`);
        const score = Math.min(
          10,
          Math.max(1, Math.round((s.relevance ?? 0) / 2) || 5),
        );
        return {
          title: s.title,
          link: s.link,
          why_it_matters:
            s.summary?.slice(0, 220) ||
            `Worth a look for JS/AI builders following ${s.source}.`,
          trend_score: score,
          angle,
          _rel: s.relevance ?? 0,
        };
      })
      .sort((a, b) => b._rel - a._rel);

    const prefer: StoryBucket[] =
      required === 'security-bug'
        ? ['security-bug']
        : required === 'js-lib'
          ? ['js-lib']
          : required === 'ai-devtools'
            ? ['ai-devtools']
            : ['js-lib', 'ai-devtools', 'dev-tool', 'security-bug'];

    const picked: typeof scored = [];
    for (const bucket of prefer) {
      for (const s of scored) {
        if (picked.length >= 10) break;
        if (s.angle === bucket && !picked.some((p) => p.link === s.link)) {
          picked.push(s);
        }
      }
    }
    for (const s of scored) {
      if (picked.length >= 10) break;
      if (!picked.some((p) => p.link === s.link)) picked.push(s);
    }

    return {
      top_stories: picked.slice(0, 10).map((s, i) => ({
        rank: i + 1,
        title: s.title,
        link: s.link,
        why_it_matters: s.why_it_matters,
        trend_score: s.trend_score,
        angle: s.angle,
      })),
    };
  }

  rankHeuristic(
    topStories: z.infer<typeof TopStoriesSchema>,
    required?: ContentType,
  ): z.infer<typeof RankSchema> {
    const list = topStories.top_stories || [];
    const prefer =
      required === 'security-bug'
        ? ['security-bug']
        : required === 'js-lib'
          ? ['js-lib']
          : required === 'ai-devtools'
            ? ['ai-devtools']
            : ['js-lib', 'ai-devtools', 'dev-tool'];

    let winner =
      list.find((s) => prefer.includes(normalizeBucket(s.angle))) || list[0];
    if (!winner) {
      throw new Error('No stories to rank');
    }
    return {
      winner: {
        title: winner.title,
        link: winner.link,
        why_it_matters: winner.why_it_matters,
        trend_score: winner.trend_score,
        angle: winner.angle,
        prediction_reason: 'Heuristic pick (LLM JSON unavailable)',
      },
      runners_up: list
        .filter((s) => s.link !== winner.link)
        .slice(0, 3)
        .map((s) => ({
          title: s.title,
          reason_skipped: 'Not selected by heuristic',
        })),
    };
  }

  async research(stories: CollectedStory[], required?: ContentType) {
    const model = this.model('LLM_RESEARCH_MODEL', 'openai/gpt-oss-20b');
    const compact = stories.slice(0, 10).map((s, i) => ({
      i: i + 1,
      title: s.title.slice(0, 100),
      link: s.link,
      blurb: s.summary.slice(0, 80),
    }));

    try {
      const result = await this.llm.chatJson<z.infer<typeof TopStoriesSchema>>({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `Pick up to 10 developer news stories for a JS/AI builder. Prefer npm/React/Node releases and AI coding tools; include at most 3 security/CVE items.

Reply with ONLY this JSON shape (no prose):
{"top_stories":[{"rank":1,"title":"","link":"","why_it_matters":"one sentence action","trend_score":7,"angle":"js-lib"}]}

angle must be one of: js-lib, ai-devtools, security-bug, dev-tool.
Copy title and link exactly from the input list.`,
          },
          {
            role: 'user',
            content: JSON.stringify({ stories: compact, prefer: required || 'mixed' }),
          },
        ],
      });
      const parsed = TopStoriesSchema.parse(result.data);
      if (!parsed.top_stories?.length) throw new Error('Empty top_stories');
      return { ...result, data: parsed };
    } catch (err) {
      this.log.warn(
        `Research LLM failed, using heuristic: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const data = this.researchHeuristic(stories, required);
      return {
        data,
        raw: JSON.stringify(data),
        model: 'heuristic',
        latencyMs: 0,
      };
    }
  }

  async rank(
    topStories: z.infer<typeof TopStoriesSchema>,
    used?: Array<{ title: string; link: string }>,
    required?: ContentType,
  ) {
    const model = this.model('LLM_RANK_MODEL', 'openai/gpt-oss-20b');
    const slim = {
      stories: (topStories.top_stories || []).slice(0, 10).map((s) => ({
        title: s.title,
        link: s.link,
        angle: s.angle,
        why: s.why_it_matters?.slice(0, 120),
        score: s.trend_score,
      })),
      used: (used || []).slice(0, 12),
      prefer: required || null,
    };

    try {
      const result = await this.llm.chatJson<z.infer<typeof RankSchema>>({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `Pick ONE unused story as the LinkedIn winner for a JS/AI developer. Prefer js-lib or ai-devtools over CVE unless prefer=security-bug.

Reply with ONLY JSON:
{"winner":{"title":"","link":"","why_it_matters":"","trend_score":8,"angle":"js-lib","prediction_reason":""},"runners_up":[{"title":"","reason_skipped":""}]}

Copy title/link from the list. Never invent a story.`,
          },
          { role: 'user', content: JSON.stringify(slim) },
        ],
      });
      return { ...result, data: RankSchema.parse(result.data) };
    } catch (err) {
      this.log.warn(
        `Rank LLM failed, using heuristic: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const data = this.rankHeuristic(topStories, required);
      return {
        data,
        raw: JSON.stringify(data),
        model: 'heuristic',
        latencyMs: 0,
      };
    }
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
    const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
      model,
      messages: [
        {
          role: 'system',
          content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI builder).

Write TWO drafts for the winning story. Each draft body is exactly TWO long paragraphs (not bullets, not one-liners).

${styles}

Rules:
- Hook: one short sentence (stored in "hook", also used as the first line of the post)
- Body: EXACTLY two long paragraphs, separated by a blank line
- Each paragraph: 90–140 words of flowing prose (full sentences)
- Teach something concrete (upgrade, pin, migrate, patch, try a tool)
- Casual clear English. Sound like a person, not a news wire
- Add light dry humour: one wry aside or self-aware jab per draft (builder pain, docs, AI being confidently wrong) — never a joke-only post
- End the second paragraph with one question
- Max 2 hashtags after the second paragraph
- Do NOT invent fake metrics, clients, or personal stories
- Never use: synergy, disrupt, game-changer, revolutionary
- Forbidden: bullet lists, numbered lists, one sentence per line, "BRIEF and BIG" short-line layout
- This story has not been posted yet. Write a fresh take, not a recap of an earlier post.

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
- Line 1: short hook wrapped in **double asterisks**, then a blank line
- Then EXACTLY two long paragraphs of flowing prose (90–140 words each), separated by one blank line
- In the body, wrap 2–4 short key phrases in *single asterisks* for italic emphasis (never whole paragraphs)
- Include ONE dry humour beat (wry aside / mild self-roast / absurd-but-true builder moment) — light touch, not a comedy set
- End the second paragraph with one question
- Max 2 hashtags after the paragraphs
- Casual, direct. No bullets. No one-sentence-per-line layout
- Do not invent fake metrics or personal stories
- LinkedIn has no rich text: use **bold** and *italic* Markdown markers only (the app converts them to Unicode)

Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"ONE concrete photoreal scene that depicts THIS article topic (people, desk, tools) — never abstract glowing orbs/lens flares","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST of the two essay drafts into ONE final LinkedIn post that sounds like he wrote it.

LAYOUT (non-negotiable):
- Line 1: short hook wrapped in **double asterisks**, then a blank line
- Then EXACTLY two long paragraphs of flowing prose (90–140 words each)
- Separate the two paragraphs with one blank line
- In the body, wrap 2–4 short key phrases in *single asterisks* for italic emphasis (never whole paragraphs)
- Include ONE dry humour beat (wry aside / mild self-roast / absurd-but-true builder moment) — light touch, not a comedy set
- Full sentences. No bullets, no numbered lists, no one-thought-per-line
- End the second paragraph with one question
- Max 2 hashtags after the second paragraph
- Stay under 3000 characters total (LinkedIn limit)
- LinkedIn has no rich text: use **bold** and *italic* Markdown markers only (the app converts them to Unicode Bold Sans / Italic Sans)

CRITICAL: Mimic the REAL writing samples (rhythm, honesty, dry humour). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

image_prompt rules (critical for the LinkedIn thumbnail):
- Describe ONE specific photoreal scene that a stranger would recognize as THIS story (use objects from the article: agents→multiple sticky notes merging into one board; CVE→laptop with advisory; npm release→changelog on second monitor)
- Ban: abstract CGI, glowing orbs, lens flares, neural-net spheres, generic "AI concept art"

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_essay|journey_essay","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene for THIS article, no text overlay","hashtags":["#a","#b"],"source_title":"...","source_link":"..."}`;

    const result = await this.llm.chatJson({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nDo not repeat these previous posts (new story, new argument, new hook):\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}

Every key is required in the JSON: post_text (min ~400 chars, two paragraphs with **hook** and *key phrases*), hook, image_prompt, hashtags, chosen_style, source_title, source_link.`,
        },
      ],
    });

    const data = this.coerceVoiceOutput(result.data, opts);
    return { ...result, data };
  }

  /** Fill gaps when Groq returns partial / wrong-shaped voice JSON. */
  private coerceVoiceOutput(
    raw: unknown,
    opts: {
      drafts: z.infer<typeof ContentSchema>;
      winner: z.infer<typeof RankSchema>['winner'];
    },
  ): z.infer<typeof VoiceOutputSchema> {
    const obj =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

    const bestDraft =
      opts.drafts.drafts.find((d) => d.body?.trim()) || opts.drafts.drafts[0];

    const pickStr = (...keys: string[]) => {
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };

    let hook =
      pickStr('hook', ' Hook', 'title') ||
      bestDraft?.hook ||
      opts.winner.title.slice(0, 120);

    let postText =
      pickStr('post_text', 'postText', 'text', 'body', 'content') ||
      (bestDraft
        ? `${bestDraft.hook}\n\n${bestDraft.body}`.trim()
        : '');

    // Model sometimes returns only chosen_style / short fragment.
    if (postText.length < 200 && bestDraft?.body) {
      const why = opts.winner.why_it_matters || '';
      postText = [
        hook,
        '',
        bestDraft.body.trim(),
        '',
        why
          ? `${why} Worth shipping a concrete change this week — what would you try first?`
          : 'Worth shipping a concrete change this week — what would you try first?',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n')
        .trim();
    }

    if (postText.length < 200) {
      const pad = opts.winner.why_it_matters || opts.winner.title;
      postText = `${postText}\n\n${pad}\n\nWhat would you ship first after reading this?`.trim();
    }

    // Ensure hook is the first line of the post when missing from model.
    if (!postText.startsWith(hook) && hook) {
      postText = `${hook}\n\n${postText}`.trim();
    }

    let imagePrompt =
      pickStr('image_prompt', 'imagePrompt', 'visual') ||
      `Photoreal desk scene illustrating: ${opts.winner.title}. Developer at a laptop, concrete props matching the article, no abstract glowing orbs, no text.`;

    const sourceTitle =
      pickStr('source_title', 'sourceTitle') || opts.winner.title;
    const sourceLink =
      pickStr('source_link', 'sourceLink', 'link') || opts.winner.link;

    let hashtags: string[] = [];
    const rawTags = obj.hashtags;
    if (Array.isArray(rawTags)) {
      hashtags = rawTags.filter((t): t is string => typeof t === 'string').slice(0, 5);
    }

    const chosenStyle =
      pickStr('chosen_style', 'chosenStyle', 'style') ||
      bestDraft?.style ||
      'operator_essay';

    // Convert **bold** / *italic* → LinkedIn Unicode; bold hook line if model forgot markers.
    const styledPost = polishLinkedInPostText(postText, hook);
    const styledHook = applyLinkedInMarkdown(
      hook.includes('**') || hook.includes('*')
        ? hook
        : `**${hook.replace(/^\*+|\*+$/g, '').trim()}**`,
    );
    // Keep hook field as plain-ish readable text for UI metadata, but prefer styled if already unicode.
    const hookForMeta = /[\u{1D400}-\u{1D7FF}]/u.test(styledHook)
      ? styledHook
      : formatLinkedInText('Bold Sans', hook.replace(/\*+/g, '').trim());

    const candidate = {
      post_text: styledPost,
      hook: hookForMeta,
      image_prompt: imagePrompt,
      hashtags,
      chosen_style: chosenStyle,
      source_title: sourceTitle,
      source_link: sourceLink,
    };

    try {
      return VoiceOutputSchema.parse(candidate);
    } catch (err) {
      // Last resort: force-length pad so the pipeline can continue.
      const forced = {
        ...candidate,
        post_text: polishLinkedInPostText(
          (candidate.post_text + ' ' + opts.winner.why_it_matters)
            .padEnd(220, '.')
            .slice(0, 2800),
          hook,
        ),
        hook: candidate.hook || formatLinkedInText('Bold Sans', opts.winner.title),
        image_prompt: candidate.image_prompt || `Scene about ${opts.winner.title}`,
        source_title: candidate.source_title || opts.winner.title,
        source_link: candidate.source_link || opts.winner.link || 'https://example.com',
      };
      this.log.warn(
        `Voice output coerced after schema miss: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return VoiceOutputSchema.parse(forced);
    }
  }

  /**
   * Compress the LinkedIn draft into a single X/Twitter post (≤280 chars).
   * Uses the voice model; falls back to a deterministic clip if JSON fails.
   */
  async writeTweet(opts: {
    postText: string;
    hook: string;
    sourceTitle?: string;
    sourceLink?: string;
  }): Promise<{ tweet: string; latencyMs: number; model: string }> {
    const model = this.model('LLM_VOICE_MODEL', 'openai/gpt-oss-20b');
    const plainPost = fromUnicodeVariant(opts.postText).replace(/\s+/g, ' ').trim();
    const plainHook = fromUnicodeVariant(opts.hook).replace(/\s+/g, ' ').trim();
    const link = (opts.sourceLink || '').trim();

    try {
      const result = await this.llm.chatJson<{ tweet?: string; text?: string }>({
        model,
        temperature: 0.35,
        messages: [
          {
            role: 'system',
            content: `You write one X/Twitter post for Prathamesh Patil (JS/AI builder).

Rules:
- Return ONLY JSON: {"tweet":"..."}
- Max 240 characters in "tweet" (a source URL may be appended later; stay under 240)
- Plain text only — no Markdown, no **bold**, no Unicode fancy letters
- Same angle as the LinkedIn post, but punchy: hook + one concrete takeaway + optional dry humour
- Max one hashtag (or none)
- No "Thread:" / numbering / "1/"
- Do not invent facts not in the source post`,
          },
          {
            role: 'user',
            content: `Hook: ${plainHook}\n\nLinkedIn post:\n${plainPost.slice(0, 1800)}\n\nSource: ${opts.sourceTitle || ''}`,
          },
        ],
      });
      const raw =
        (typeof result.data?.tweet === 'string' && result.data.tweet) ||
        (typeof result.data?.text === 'string' && result.data.text) ||
        '';
      const tweet = this.finalizeTweet(raw, link);
      if (tweet.length >= 40) {
        return { tweet, latencyMs: result.latencyMs, model: result.model };
      }
    } catch (err) {
      this.log.warn(
        `Tweet LLM failed, using clip: ${err instanceof Error ? err.message : err}`,
      );
    }

    const fallback = this.finalizeTweet(
      `${plainHook}. ${plainPost}`.replace(/\s+/g, ' ').trim(),
      link,
    );
    return { tweet: fallback, latencyMs: 0, model: 'heuristic' };
  }

  /** Fit body (+ optional URL counted as 23 for t.co) into ≤280. */
  private finalizeTweet(raw: string, link?: string): string {
    const cleaned = fromUnicodeVariant(raw)
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const url = (link || '').trim();
    const TCO = 23;
    if (url && /^https?:\/\//i.test(url)) {
      const budget = 280 - 1 - TCO; // newline + shortened URL
      const body = this.clipAtWord(cleaned, budget);
      return `${body}\n${url}`.slice(0, 400); // hard safety; real count ≈ body+1+23
    }
    return this.clipAtWord(cleaned, 280);
  }

  private clipAtWord(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, Math.max(0, max - 1));
    const sp = cut.lastIndexOf(' ');
    return `${(sp > 24 ? cut.slice(0, sp) : cut).trim()}…`;
  }
}
