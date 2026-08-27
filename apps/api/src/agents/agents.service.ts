import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { CollectedStory } from '../news/news.service';
import { cleanStoryBlurb, isHnMetadata } from '../news/hn-item';
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
        temperature: 0.75,
        messages: [
          {
            role: 'system',
            content: `You write LinkedIn drafts for Prathamesh Patil (JS/AI builder). Do not use <think> tags. Raw JSON only.

Write TWO LinkedIn drafts for the winning story. Length ~240 words. Humour + sarcasm are mandatory.

${styles}

HUMOUR (non-negotiable):
- Sound like a tired but funny coworker, not a changelog
- Hook can be snarky. Example energy: "Node 22 landed. Yes, you are still on 18 and calling it 'stable'."
- Roast upgrade theater, lockfiles, "we'll do it next sprint", README-driven development
- At least two sarcastic beats. One *italic* aside
- Funny AND useful. If you delete the jokes, the post should still teach something
- No dad-joke openers. No "as developers we"

Rules:
- Hook: one short headline about THIS story (name the tool / CVE / release)
- Body: EXACTLY two long paragraphs of flowing prose (~100–120 words each), separated by a blank line
- Paragraph 1: what shipped / why it matters, with specific names (engine, API, version) — and a smirk
- Paragraph 2: what to do this week (upgrade, pin, swap a client, add a CI check) — still sarcastic
- End the second paragraph with one question
- 5–8 hashtags after the question
- NEVER paste "Article URL", "Comments URL", Points, or HN score dumps
- Do NOT invent fake metrics, clients, or personal stories
- Never use: synergy, disrupt, game-changer, revolutionary, "here's the thing", "let's dive in"
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
      take ||
        `${title} showed up on the timeline, which is usually how we discover work we already promised to do.`,
      host.includes('github')
        ? `It is a repo, not a Ted Talk. Open the README before you quote a thread. The useful bit is almost always one command, one lockfile line, or one CI check — not the star count you will screenshot for Slack.`
        : `Read the notes, not the HN scorecard. The useful bit is almost always one command, one lockfile line, or one CI check.`,
      `Name the API, the version, the failure mode. If you cannot name it, you are just vibes-posting, and we have enough of that.`,
    ].join(' ');
    const p2 = [
      `If this lands in your stack, do the boring pass nobody puts on LinkedIn: pin the version, run the tests you already have, write down the first error.`,
      `*Yes, including the upgrade you swore was next sprint.*`,
      `Leave a CI note so the next person does not rediscover it at 1am and call it "research." Then tell the team what you changed, not that you "looked into it."`,
      `What are you actually shipping this week, besides opinions?`,
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

Produce a meaningfully different draft that addresses the feedback. Keep it funny and sarcastic.

LAYOUT (~240 words):
- Line 1: short hook wrapped in **double asterisks**, then a blank line
- Then EXACTLY two long paragraphs of flowing prose (~100–120 words each), separated by one blank line
- Para 1 = what shipped / why it matters, with a smirk. Para 2 = what to do this week, still sarcastic
- At least two sarcastic beats. One *italic* aside
- End the second paragraph with one question, then 5–8 hashtags
- NEVER copy Article URL / Comments URL / Points / HN metadata
- Do not invent fake metrics or personal stories
- LinkedIn has no rich text: use **bold** and *italic* Markdown markers only (the app converts them to Unicode)

Return ONLY JSON:
{"chosen_style":"regenerated","post_text":"...","hook":"...","image_prompt":"ONE concrete photoreal scene that depicts THIS article topic (people, desk, tools) — never abstract glowing orbs/lens flares","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`
      : `You are the Voice Agent for Prathamesh Patil.

Rewrite the BEST of the two essay drafts into ONE final LinkedIn post that sounds like he wrote it — funny, a bit savage, still useful.

LAYOUT (~220–280 words):
- Line 1: short hook wrapped in **double asterisks** naming the tool/CVE/release. Snark is good.
- Then EXACTLY two long paragraphs of flowing prose (~100–120 words each)
- Separate the two paragraphs with one blank line
- Para 1: facts + sarcasm. Para 2: what to do this week + sarcasm
- End with one question, then 5–8 hashtags
- Stay under 3000 characters total (LinkedIn limit)
- NEVER copy Article URL, Comments URL, Points, or "# Comments"

HUMOUR (if the post could be a press release, rewrite it):
- Coworker Slack energy. Tired. Specific. Mean to the situation, not a person
- At least TWO sarcastic beats (hook can count as one)
- One *italic* aside like *yes, including the migrate you swore you'd do last quarter*
- Roast: upgrade theater, "stable" as an excuse, lockfiles, README archaeology, CVE-of-the-week
- Still teach: name the version, the API, the command
- Forbidden: "here's the thing", "let's dive in", "it's worth noting", "as developers we", game-changer, thrilled to announce

MARKDOWN (we convert it to LinkedIn Unicode):
- Wrap the hook line in **double asterisks**
- Bold 1–2 key phrases (version, CVE, tool name)
- Italicize one aside with *single asterisks*
- Never wrap hashtags or URLs

CRITICAL: Mimic the REAL writing samples (rhythm, honesty, dry humour). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

image_prompt rules (critical for the LinkedIn thumbnail):
- Describe ONE specific photoreal scene that a stranger would recognize as THIS story (use objects from the article: agents→multiple sticky notes merging into one board; CVE→laptop with advisory; npm release→changelog on second monitor)
- Ban: abstract CGI, glowing orbs, lens flares, neural-net spheres, generic "AI concept art"

Voice profile:
${profile}

Return ONLY JSON:
{"chosen_style":"operator_essay|journey_essay","post_text":"...","hook":"...","image_prompt":"concrete photoreal scene for THIS article, no text overlay","hashtags":["#a","#b","#c","#d","#e"],"source_title":"...","source_link":"..."}`;

    try {
      const result = await this.llm.chatJson({
        model,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `${system}\n\nDo not use <think> tags. Return raw JSON only.`,
          },
          {
            role: 'user',
            content: `===== REAL VOICE SAMPLES =====\n${samplesText}\n===== END SAMPLES =====\n\nContent drafts:\n${JSON.stringify(opts.drafts)}\n\nWinner:\n${JSON.stringify(opts.winner)}\n\nFeedback:\n${opts.feedback || '(none)'}\n\nDo not repeat these previous posts (new story, new argument, new hook):\n${(opts.avoidPosts || []).slice(0, 6).join('\n---\n') || '(none)'}

Every key is required in the JSON: post_text (min ~400 chars, two paragraphs with **hook** and *key phrases*), hook, image_prompt, hashtags, chosen_style, source_title, source_link.`,
          },
        ],
      });

      const data = this.coerceVoiceOutput(result.data, opts);
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
        data: this.coerceVoiceOutput(
          {
            chosen_style: 'operator_essay',
            post_text,
            hook,
            image_prompt: `Editorial card about ${hook}`,
            hashtags: ['#BuildInPublic', '#LearnInPublic', '#JavaScript'],
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
