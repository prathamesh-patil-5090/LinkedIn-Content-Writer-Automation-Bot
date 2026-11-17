import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { CollectedStory } from '../news/news.service';
import { cleanStoryBlurb, isHnMetadata } from '../news/hn-item';
import {
  looksLikeBoilerplate,
} from '../news/article-context';
import {
  AUTHORITY_BUCKETS,
  VoiceOutputSchema,
  normalizeBucket,
  polishLinkedInPostText,
  formatLinkedInText,
  applyLinkedInMarkdown,
  fromUnicodeVariant,
  storyBucketsFor,
} from '@ldp/shared';
import type { ContentType, StoryBucket } from '@ldp/shared';
import { MIN_POST_CHARS, postRulesPrompt } from '../content/post-rules';
import {
  TOPIC_PILLARS,
  topicPillar,
  topicPillarsPrompt,
} from '../content/topic-authority';
import { normalizeBullets } from '../linkedin/format';
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

  private draftBrief(): string {
    const p = path.resolve(process.cwd(), '../../prompts/draft-v2.md');
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return 'The reader must learn what the thing is, who made it, how it works, and its trade-offs. Fail if the post could apply to any other article by swapping the title.';
    }
  }

  private voiceProfile(): string {
    const p = path.resolve(process.cwd(), '../../prompts/voice-profile.md');
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return 'Write like Prathamesh Patil: pragmatic developer, honest, casual, direct.';
    }
  }

  /** Keyword rank when Groq JSON mode flakes — keeps Generate usable. */
  researchHeuristic(
    stories: CollectedStory[],
    required?: ContentType,
  ): z.infer<typeof TopStoriesSchema> {
    const scored = stories
      .map((s) => {
        const pillar = topicPillar(s.title, s.summary);
        const angle = pillar
          ? TOPIC_PILLARS[pillar].bucket
          : normalizeBucket(`${s.title} ${s.summary} ${s.source}`);
        const score = Math.min(
          10,
          Math.max(1, Math.round((s.relevance ?? 0) / 2) || 5),
        );
        return {
          title: s.title,
          link: s.link,
          why_it_matters:
            cleanStoryBlurb(s.title, s.summary).slice(0, 220) ||
            `Worth a look for JS/AI builders following ${s.source}.`,
          trend_score: score,
          angle,
          _rel: s.relevance ?? 0,
        };
      })
      .sort((a, b) => b._rel - a._rel);

    const prefer: StoryBucket[] = required
      ? storyBucketsFor(required)
      : AUTHORITY_BUCKETS;

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
    const prefer: StoryBucket[] = required
      ? storyBucketsFor(required)
      : AUTHORITY_BUCKETS;

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
    const compact = stories.slice(0, 18).map((s, i) => ({
      i: i + 1,
      title: s.title.slice(0, 140),
      link: s.link,
      source: s.source,
      blurb: cleanStoryBlurb(s.title, s.summary).slice(0, 160),
    }));
    const mixRule = required
      ? `This run's content type is "${required}". Prefer stories that fit it, but still return stories from both areas so there are fallbacks.`
      : `Return a mix across both areas.`;

    try {
      const result = await this.llm.chatJson<z.infer<typeof TopStoriesSchema>>({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You pick LinkedIn stories for a developer who posts in exactly two areas, so every post builds authority with the same audience:
${topicPillarsPrompt()}

Pick the TOP 8 stories that sit inside those two areas. Fewer than 8 is fine if the rest are off-topic.

${mixRule}

Reject everything else: CVE and security roundups, CSS and design tips, other languages and ecosystems, career advice, podcasts, funding, politics.
Prefer stories with a mechanism and a trade-off to explain over plain announcements.

why_it_matters: one short sentence on the pattern or trade-off a developer would want to understand.
Copy title and link exactly from the input list.

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
    const usedBlock =
      used && used.length
        ? `\n\nALREADY USED — never pick these titles or links:\n${JSON.stringify(used.slice(0, 12))}`
        : '';
    const typeRule = required
      ? `Required content type for this slot: "${required}".
- ai-devtools: an AI engineering / LLM infrastructure story
- js-lib: a TypeScript / full-stack systems story
- howto: a story from either area that teaches one concrete pattern
- architecture: a story from either area that exposes a design trade-off
If nothing fits the required type, pick the strongest story from the other area.`
      : `Pick the strongest ai-devtools or js-lib story.`;
    const slim = {
      stories: (topStories.top_stories || []).slice(0, 10).map((s) => ({
        title: s.title,
        link: s.link,
        angle: s.angle,
        why: s.why_it_matters?.slice(0, 120),
        score: s.trend_score,
      })),
      prefer: required || null,
    };

    try {
      const result = await this.llm.chatJson<z.infer<typeof RankSchema>>({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You rank ONE LinkedIn story for a developer who posts in exactly two areas:
${topicPillarsPrompt()}

${typeRule}

Never pick a CVE or security roundup, a CSS tip, another ecosystem, a podcast, a funding headline, or a vague essay.
Prefer the story with the clearest mechanism and trade-off to break down.
The winner MUST be a story that has not been posted before (see already-used list).
Copy title/link from the list. Never invent a story.

Return ONLY valid JSON. trend_score is a single number. Example:
{"winner":{"title":"Node 22 ships","link":"https://example.com","why_it_matters":"Upgrade Node.","trend_score":8,"angle":"js-lib","prediction_reason":"Fresh JS release"},"runners_up":[{"title":"Other","reason_skipped":"weaker takeaway"}]}`,
          },
          {
            role: 'user',
            content: JSON.stringify(slim) + usedBlock,
          },
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
    articleExcerpt?: string,
    /** True when the story is the author's own project (first person allowed). */
    ownWork = false,
  ) {
    const model = this.model('LLM_CONTENT_MODEL', 'openai/gpt-oss-20b');
    const [styleA, styleB] =
      contentType === 'howto'
        ? [
            'teach_breakdown — the one pattern worth copying from this story, step by step',
            'tradeoff_breakdown — what the approach gains, what it costs, when it is the wrong call',
          ]
        : contentType === 'architecture'
          ? [
              'tradeoff_breakdown — the design choice this story exposes, and when each side wins',
              'pattern_breakdown — what the pattern is, how it works, where it fits',
            ]
          : [
              'pattern_breakdown — what it is, how it works, where it fits',
              'tradeoff_breakdown — what the approach gains, what it costs, when it is the wrong call',
            ];
    const styles = `Styles:\n1. ${styleA}\n2. ${styleB}`;
    const styleJson = JSON.stringify({
      drafts: [styleA, styleB].map((s) => ({
        style: s.split(' ')[0],
        hook: '',
        body: '',
      })),
    });
    const excerpt = (articleExcerpt || '').slice(0, 3200);
    try {
      const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI engineer). Do not use <think> tags. Raw JSON only.

Write TWO short drafts of the same story, one per style. "hook" is line 1 without the ** markers; "body" is everything after it. No hashtags in the body.

${styles}

${postRulesPrompt(ownWork)}

${this.draftBrief()}

Return ONLY JSON:
${styleJson}`,
          },
          {
            role: 'user',
            content:
              JSON.stringify({
                title: winner.title,
                source: winner.link,
                why_it_matters: winner.why_it_matters,
                angle: winner.angle,
                article_excerpt: excerpt || null,
              }) +
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
        data: this.templateDrafts(winner, excerpt),
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
      : cleanStoryBlurb(title, stripBriefLeak(winner.why_it_matters || ''));
    return { title, why };
  }

  private templateDrafts(
    winner: z.infer<typeof RankSchema>['winner'],
    excerpt = '',
  ): z.infer<typeof ContentSchema> {
    // Raw facts for the voice stage to write from. Never published as-is.
    const { title, why } = this.storyFacts(winner);
    const facts = this.extractFactLines(why, excerpt);
    return {
      drafts: [
        {
          style: 'pattern_breakdown',
          hook: title,
          body: [why, ...facts].filter(Boolean).join('\n\n') || title,
        },
      ],
    };
  }

  /** Up to 3 substantive sentences from the blurb and article excerpt. */
  private extractFactLines(why: string, excerpt: string): string[] {
    const blob = `${why}\n${excerpt}`.replace(/\s+/g, ' ').trim();
    const sentences = blob
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 60 && s.length < 280)
      .filter(
        (s) => !/cookie|subscribe|newsletter|sign in|advertisement/i.test(s),
      );
    const out: string[] = [];
    for (const s of sentences) {
      if (out.length >= 3) break;
      if (!out.some((x) => x.slice(0, 40) === s.slice(0, 40))) out.push(s);
    }
    return out;
  }

  async applyVoice(opts: {
    drafts: z.infer<typeof ContentSchema>;
    winner: z.infer<typeof RankSchema>['winner'];
    voiceSamples: Array<{ title: string; body: string }>;
    feedback?: string;
    avoidPosts?: string[];
    articleExcerpt?: string;
    /** True when the story is the author's own project (first person allowed). */
    ownWork?: boolean;
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
    const excerpt = (opts.articleExcerpt || '').slice(0, 3200);

    const postRules = `${postRulesPrompt(opts.ownWork)}

OUTPUT FIELDS:
- post_text is the whole post: bold hook line, context, bullets, your read, closing question. No hashtags and no URL inside post_text.
- hashtags go in the hashtags array. source_link is metadata copied from winner.link.`;

    const isRegen = Boolean(opts.feedback);
    const system = isRegen
      ? `You are regenerating a LinkedIn post for Prathamesh Patil after feedback.

${postRules}

Address every point in the feedback. Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST draft into ONE LinkedIn post in his voice.

${postRules}

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"pattern_breakdown|tradeoff_breakdown|teach_breakdown","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`;

    const samplesNote = opts.ownWork
      ? ''
      : `These samples are about his own projects, so they are first person. Copy their rhythm and word choice only. Do not copy their first-person framing or their topics.\n`;
    const userPayload = `===== REAL VOICE SAMPLES =====\n${samplesNote}${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nArticle excerpt (use for facts; do not copy wholesale):\n${excerpt || '(none fetched)'}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nAvoid echoing these older posts:\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}`;

    try {
      const result = await this.llm.chatJson({
        model,
        temperature: 0.65,
        messages: [
          {
            role: 'system',
            content: `${system}\n\nDo not use <think> tags. Return raw JSON only.`,
          },
          { role: 'user', content: userPayload },
        ],
      });

      const data = this.coerceVoiceOutput(result.data, opts);
      if (
        !looksLikeBoilerplate(data.post_text) &&
        data.post_text.length >= MIN_POST_CHARS
      ) {
        return { ...result, data };
      }
      this.log.warn('Voice output looked thin/boilerplate; trying direct post');
    } catch (err) {
      this.log.warn(
        `Voice LLM failed, trying direct post: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const direct = await this.writePostDirect({
      winner: opts.winner,
      voiceSamples: opts.voiceSamples,
      feedback: opts.feedback,
      articleExcerpt: excerpt,
      avoidPosts: opts.avoidPosts,
      ownWork: opts.ownWork,
    });
    if (direct) return direct;

    // No canned fallback: a template post would publish text nobody wrote
    // about this story. Failing the run is the honest outcome.
    throw new Error(
      'Writer LLM returned no usable post (voice and direct attempts failed)',
    );
  }

  /** Single-shot post when the draft→voice path fails or goes generic. */
  private async writePostDirect(opts: {
    winner: z.infer<typeof RankSchema>['winner'];
    voiceSamples: Array<{ title: string; body: string }>;
    feedback?: string;
    articleExcerpt?: string;
    avoidPosts?: string[];
    ownWork?: boolean;
  }) {
    const model = this.model('LLM_VOICE_MODEL', 'openai/gpt-oss-20b');
    try {
      const result = await this.llm.chatJson({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `Write ONE LinkedIn post for Prathamesh Patil (JS/AI engineer).

Return ONLY JSON:
{"chosen_style":"pattern_breakdown","post_text":"...","hook":"...","image_prompt":"...","hashtags":["#a","#b","#c","#d","#e","#f"],"source_title":"...","source_link":"..."}

${postRulesPrompt(opts.ownWork)}

OUTPUT FIELDS:
- post_text is the whole post. No hashtags and no URL inside post_text.
- hashtags go in the hashtags array. source_link is metadata copied from winner.link.
- Feedback, if present, must be addressed point by point.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              winner: opts.winner,
              article_excerpt: (opts.articleExcerpt || '').slice(0, 3500),
              feedback: opts.feedback || null,
              voice_sample_titles: opts.voiceSamples.map((s) => s.title),
              avoid_hooks: (opts.avoidPosts || []).slice(0, 3),
            }),
          },
        ],
      });
      // No draft to fall back on here: a thin answer must fail, not be padded
      // out with the raw article excerpt.
      const data = this.coerceVoiceOutput(result.data, {
        drafts: { drafts: [] },
        winner: opts.winner,
      });
      if (
        looksLikeBoilerplate(data.post_text) ||
        data.post_text.length < MIN_POST_CHARS
      ) {
        return null;
      }
      return { ...result, data };
    } catch (err) {
      this.log.warn(
        `Direct post LLM failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
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
    hook = stripBriefLeak(hook);

    let postText =
      pickStr('post_text', 'postText', 'text', 'body', 'content') ||
      (bestDraft
        ? `${bestDraft.hook}\n\n${bestDraft.body}`.trim()
        : '');
    postText = stripBriefLeak(postText);

    // Model sometimes returns only chosen_style / short fragment: fall back to
    // the written draft. Never pad with filler sentences; a post that is still
    // too thin fails the schema below and the caller retries.
    if (postText.length < 280 && bestDraft?.body) {
      postText = `${hook}\n\n${stripBriefLeak(bestDraft.body.trim())}`;
    }
    postText = normalizeBullets(postText);

    // Ensure hook is the first line — compare folded text so **hook** / unicode
    // bold does not cause a second plain prepend.
    const fold = (s: string) =>
      fromUnicodeVariant(s)
        .replace(/\*+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const firstLine =
      postText.split('\n').find((l) => l.trim())?.trim() || '';
    if (hook && fold(firstLine) !== fold(hook)) {
      postText = `${hook}\n\n${postText}`.trim();
    }
    // Drop accidental duplicate title lines (Title\n\nTitle\n\nBody).
    {
      const lines = postText.split('\n');
      const idxs: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) idxs.push(i);
      }
      if (
        idxs.length >= 2 &&
        fold(lines[idxs[0]]) &&
        fold(lines[idxs[0]]) === fold(lines[idxs[1]])
      ) {
        postText = [...lines.slice(0, idxs[0] + 1), ...lines.slice(idxs[1] + 1)]
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
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
      hashtags = rawTags.filter((t): t is string => typeof t === 'string').slice(0, 8);
    }

    const chosenStyle =
      pickStr('chosen_style', 'chosenStyle', 'style') ||
      bestDraft?.style ||
      'pattern_breakdown';

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

    // Throws when the post is too thin; callers treat that as a failed attempt.
    return VoiceOutputSchema.parse(candidate);
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
- Plain text only: no Markdown, no **bold**, no backticks, no Unicode fancy letters
- No em dashes, en dashes, or spaced hyphen pauses (use commas or periods)
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
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\s*[\u2014\u2013]\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
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

/** Drop pipeline brief labels that must never appear in published copy. */
function stripBriefLeak(text: string): string {
  return text
    .replace(/^\s*Angle:\s*.+$/gim, '')
    .replace(/^\s*Preferred hook:\s*.+$/gim, '')
    .replace(/\bAngle:\s*/gi, '')
    .replace(/\bPreferred hook:\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
