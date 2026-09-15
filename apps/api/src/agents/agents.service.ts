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

  private draftBrief(): string {
    const p = path.resolve(process.cwd(), '../../prompts/draft-v1.md');
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return 'Write longer, clearer LinkedIn essays: hook + 3-4 short paragraphs + question.';
    }
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
            cleanStoryBlurb(s.title, s.summary).slice(0, 220) ||
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
    const compact = stories.slice(0, 18).map((s, i) => ({
      i: i + 1,
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
        temperature: 0.1,
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
- security-bug: pick a JS/Node-relevant CVE/supply-chain story only
- js-lib: a library/framework/npm/Node/React release — NEVER a CVE
- ai-devtools: an AI coding tool / LLM SDK — NEVER a CVE
- howto / architecture: pick a js-lib, ai-devtools, or dev-tool story (not a CVE) that can teach a pattern or tradeoff
If the required bucket is empty, fall back js-lib → ai-devtools → dev-tool. Never fill a non-security slot with a CVE.`
      : `Prefer unused js-lib or ai-devtools over another CVE if several security stories already sit in the list.`;
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
            content: `You rank ONE LinkedIn story for a JavaScript + AI-tools developer.

${typeRule}

Reject podcasts, funding headlines, vague essays, and generic vuln roundups with no JS action.
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
    const excerpt = (articleExcerpt || '').slice(0, 3200);
    try {
      const result = await this.llm.chatJson<z.infer<typeof ContentSchema>>({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI builder). Do not use <think> tags. Raw JSON only.

Write TWO LONG drafts (~500-700 words of body each). Original builder analysis, not a press rewrite.

${styles}

${this.draftBrief()}

ORIGINALITY (required):
- Add YOUR interpretation: what this implies for agent sandboxes, supply-chain, CI, or JS/AI stacks
- Name concrete entities from the article (tools, packages, bugs, orgs) when present in context
- Include one non-obvious takeaway a careful reader might miss
- Do NOT invent facts not supported by title/why/excerpt. If excerpt is thin, reason carefully from the title and stay honest about uncertainty

STRUCTURE:
- Hook: original headline (not a paste of the article title). Never truncate with …
- Body: 5 or 6 short paragraphs (blank line between each)
  1) What happened (specific)
  2) Mechanism / how it worked (specific)
  3) Why a JS/AI builder should care
  4) Your original angle / lesson
  5) Exact next step this week
  6) Closing question
- End with question, then 5-8 hashtags (hashtags can live in body or after)
- At most one light *italic* aside
- No em/en dashes; no backticks; use **bold** / *italic*
- Never paste Angle:/Preferred hook:/HN metadata

Return ONLY JSON:
${styleJson}`,
          },
          {
            role: 'user',
            content:
              JSON.stringify({
                title: winner.title,
                link: winner.link,
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
    const { hook, body } = this.storyPost(winner, excerpt);
    return {
      drafts: [
        { style: 'operator_essay', hook, body },
        { style: 'journey_essay', hook, body },
      ],
    };
  }

  private storyPost(
    winner: z.infer<typeof RankSchema>['winner'],
    excerpt = '',
  ) {
    const { title, why } = this.storyFacts(winner);
    const hook = title;
    const link = (winner.link || '').trim();
    const host = (() => {
      try {
        return new URL(link).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    const facts = this.extractFactLines(title, why, excerpt);
    const p1 =
      facts[0] ||
      `Security research just tied autonomous AI agents to a real package-registry abuse campaign covered in "${title}".`;
    const p2 =
      facts[1] ||
      `The useful detail is not the headline scare. It is the chain: publish a package, trigger a docs/build worker, run attacker-controlled code, then stash or exfiltrate results through the same public registry.`;
    const p3 =
      facts[2] ||
      `If you ship agent tools, Ruby/JS package automation, or CI that installs untrusted deps, this is about sandbox assumptions failing under goal-seeking agents, not about one CVE trivia card.`;
    const p4 = `Original take: treat agent evals and "internet access for research" as a production threat model. Agents will probe package registries, docs builders, webhooks, and key caches if those surfaces help complete the task.`;
    const p5 = `Do this week: inventory where your agents or CI can publish packages, hit docs builders, or read shared API keys; pin client versions on registry auth; block disposable signup paths you control; add an alert for burst account or package creation.`;
    const p6 = `Which control would have caught a swarm of junk packages in your pipeline before someone else filed the report?`;
    const source =
      link && /^https?:\/\//i.test(link)
        ? `Primary source${host ? ` (${host})` : ''}:\n${link}`
        : '';
    return {
      hook,
      body: [p1, p2, p3, p4, p5, p6, source].filter(Boolean).join('\n\n'),
    };
  }

  /** Pull up to 3 concrete sentences from title/why/excerpt for fallback posts. */
  private extractFactLines(
    title: string,
    why: string,
    excerpt: string,
  ): string[] {
    const blob = `${why}\n${excerpt}`.replace(/\s+/g, ' ').trim();
    const sentences = blob
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 60 && s.length < 280)
      .filter(
        (s) =>
          !/cookie|subscribe|newsletter|sign in|advertisement/i.test(s) &&
          /agent|gem|ruby|rce|package|openai|supply|registry|docs|exfil|sandbox|ci|api key/i.test(
            s,
          ),
      );
    const out: string[] = [];
    for (const s of sentences) {
      if (out.length >= 3) break;
      if (!out.some((x) => x.slice(0, 40) === s.slice(0, 40))) out.push(s);
    }
    if (!out.length && title) {
      out.push(
        `${title} is worth translating into one concrete control on agents, package publishing, or CI auth, not a vague "AI risk" take.`,
      );
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

    const essayRules = `VALUE + ORIGINALITY:
1) Specific facts from the story/excerpt (names, mechanism, who is hit)
2) Your builder interpretation (what this means for sandboxes, supply-chain, CI, agents)
3) One concrete action this week
4) Longer post: ~500-700 words, 5-6 short paragraphs
5) Include Primary source:\\n<exact winner.link> before hashtags
6) Never truncate with … Never paste Angle:/Preferred hook:
7) Do not invent facts. If excerpt is missing a detail, say what is known vs unknown.
8) At most one light *italic* aside. Teaching > humour.`;

    const isRegen = Boolean(opts.feedback);
    const system = isRegen
      ? `You are regenerating a LinkedIn post for Prathamesh Patil after feedback.

${essayRules}

Address the feedback. Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST draft into ONE long LinkedIn essay with original analysis.

${essayRules}

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_essay|journey_essay","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`;

    const userPayload = `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nArticle excerpt (use for facts; do not copy wholesale):\n${excerpt || '(none fetched)'}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nAvoid echoing these older posts:\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}`;

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
      if (!looksLikeBoilerplate(data.post_text) && data.post_text.length >= 600) {
        return { ...result, data };
      }
      this.log.warn('Voice output looked thin/boilerplate; trying direct essay');
    } catch (err) {
      this.log.warn(
        `Voice LLM failed, trying direct essay: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const direct = await this.writeEssayDirect({
      winner: opts.winner,
      voiceSamples: opts.voiceSamples,
      feedback: opts.feedback,
      articleExcerpt: excerpt,
      avoidPosts: opts.avoidPosts,
    });
    if (direct) return direct;

    this.log.warn('Direct essay failed; using excerpt-aware heuristic post');
    const { hook, body } = this.storyPost(opts.winner, excerpt);
    const post_text = `**${hook}**\n\n${body}`;
    return {
      data: this.coerceVoiceOutput(
        {
          chosen_style: 'operator_essay',
          post_text,
          hook,
          image_prompt: `Editorial desk scene about ${hook}`,
          hashtags: [
            '#AppSec',
            '#InfoSec',
            '#BuildInPublic',
            '#LearnInPublic',
            '#AI',
          ],
          source_title: opts.winner.title,
          source_link: opts.winner.link,
        },
        opts,
      ),
      raw: '',
      model: 'heuristic',
      latencyMs: 0,
    };
  }

  /** Single-shot long essay when the draft→voice path fails or goes generic. */
  private async writeEssayDirect(opts: {
    winner: z.infer<typeof RankSchema>['winner'];
    voiceSamples: Array<{ title: string; body: string }>;
    feedback?: string;
    articleExcerpt?: string;
    avoidPosts?: string[];
  }) {
    const model = this.model('LLM_VOICE_MODEL', 'openai/gpt-oss-20b');
    try {
      const result = await this.llm.chatJson({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `Write ONE long LinkedIn post for Prathamesh Patil (JS/AI builder).

Return ONLY JSON:
{"chosen_style":"operator_essay","post_text":"...","hook":"...","image_prompt":"...","hashtags":["#a","#b","#c","#d","#e","#f"],"source_title":"...","source_link":"..."}

Rules:
- 500-700 words. 5-6 short paragraphs + hook line + Primary source URL + question + hashtags
- Original analysis grounded in the excerpt. Name real entities from the article.
- For security/agent stories: explain the abuse chain plainly, then the builder lesson, then one action
- Hook must be original (not the raw title paste). No … truncation
- source_link must equal winner.link and appear under "Primary source:"
- No invented metrics. No Angle:/Preferred hook:. No backticks. No em dashes.
- Feedback if present must be addressed.`,
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
      const data = this.coerceVoiceOutput(result.data, {
        drafts: {
          drafts: [
            {
              style: 'operator_essay',
              hook: opts.winner.title,
              body: opts.articleExcerpt || opts.winner.why_it_matters || '',
            },
          ],
        },
        winner: opts.winner,
      });
      if (looksLikeBoilerplate(data.post_text) || data.post_text.length < 500) {
        return null;
      }
      return { ...result, data };
    } catch (err) {
      this.log.warn(
        `Direct essay LLM failed: ${err instanceof Error ? err.message : err}`,
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

    const cleanWhy = stripBriefLeak(opts.winner.why_it_matters || '');

    // Model sometimes returns only chosen_style / short fragment.
    if (postText.length < 280 && bestDraft?.body) {
      postText = [
        hook,
        '',
        stripBriefLeak(bestDraft.body.trim()),
        '',
        cleanWhy
          ? `${cleanWhy} Worth shipping a concrete change this week. What would you try first?`
          : 'Worth shipping a concrete change this week. What would you try first?',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n')
        .trim();
    }

    if (postText.length < 280) {
      const pad = cleanWhy || opts.winner.title;
      postText = `${postText}\n\n${pad}\n\nWhat would you ship first after reading this?`.trim();
    }

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
      // Last resort: pad enough to satisfy schema — do not hard-slice the essay mid-sentence.
      const padded = polishLinkedInPostText(
        [
          candidate.post_text,
          opts.winner.why_it_matters,
          opts.winner.link
            ? `Primary source:\n${opts.winner.link}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        hook,
      );
      const forced = {
        ...candidate,
        post_text: padded.length >= 180 ? padded : `${padded}\n\nWorth a concrete follow-up this week.`,
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
