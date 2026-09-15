import { Injectable, Logger } from '@nestjs/common';
import { GENERATING_STATUSES } from '@ldp/shared';
import {
  fallbackBuckets,
  normalizeBucket,
  storyBucketsFor,
  type ContentPillar,
  type ContentType,
} from '@ldp/shared';
import { PrismaService } from '../prisma/prisma.module';
import { NewsService } from '../news/news.service';
import { AgentsService } from '../agents/agents.service';
import { DeapiService } from '../media/deapi.service';
import { TelegramService } from '../notifications/telegram.service';
import { ConfigService } from '@nestjs/config';
import { LinkedInService } from '../linkedin/linkedin.service';
import { loadUsedIndex, UsedIndex } from './uniqueness';
import { polishDraft } from '../linkedin/polish';
import { articleUrlFromHn, cleanStoryBlurb, isHnMetadata } from '../news/hn-item';
import { fetchArticleExcerpt } from '../news/article-context';
import {
  contentTypeForHour,
  cronWindowStatus,
  POSTS_PER_DAY,
  startOfIstDay,
} from '../scheduler/cron-window';
import { ContentConfigService } from '../content/content-config.service';
import { SourceEventsService } from '../content/source-events.service';
import { OpportunityScorerService } from '../content/opportunity-scorer.service';
import { PillarService } from '../content/pillar.service';
import { AngleHookService } from '../content/angle-hook.service';
import { QualityGateService } from '../content/quality-gate.service';
import { WritingProfileService } from '../content/writing-profile.service';
import { FeedbackService } from '../content/feedback.service';
import { GithubIngestService } from '../content/github-ingest.service';

class PipelineCancelledError extends Error {
  constructor() {
    super('Stopped by user');
    this.name = 'PipelineCancelledError';
  }
}

type IntelligenceContext = {
  opportunityId?: string;
  sourceEventId?: string;
  pillar: ContentPillar;
  format?: string;
  contentScore: number;
  scoresJson?: unknown;
  selectedAngle: string;
  selectedHook: string;
  anglesJson?: unknown;
  hooksJson?: unknown;
  diversityBoosts?: Record<string, number>;
};

@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);
  private running = false;
  private activeRunId: string | null = null;
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly news: NewsService,
    private readonly agents: AgentsService,
    private readonly deapi: DeapiService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
    private readonly linkedin: LinkedInService,
    private readonly contentConfig: ContentConfigService,
    private readonly sourceEvents: SourceEventsService,
    private readonly opportunityScorer: OpportunityScorerService,
    private readonly pillars: PillarService,
    private readonly angleHook: AngleHookService,
    private readonly qualityGate: QualityGateService,
    private readonly writingProfile: WritingProfileService,
    private readonly feedback: FeedbackService,
    private readonly githubIngest: GithubIngestService,
  ) {}

  async startRun(
    triggeredBy: 'cron' | 'manual',
    selectedStory?: {
      title: string;
      link: string;
      why_it_matters?: string;
      angle?: string;
      trend_score?: number;
      prediction_reason?: string;
    },
  ) {
    if (this.running) {
      throw Object.assign(new Error('Pipeline already running'), {
        status: 409,
      });
    }

    // After a crash/restart, DB can still say "writing" while nothing is running.
    await this.clearOrphanedGenerating();

    if (triggeredBy === 'cron') {
      const posted = await this.postsPublishedToday();
      if (posted >= POSTS_PER_DAY) {
        throw Object.assign(
          new Error(`Daily cap reached (${POSTS_PER_DAY} posts)`),
          { status: 409 },
        );
      }
    }

    const blocking =
      triggeredBy === 'cron'
        ? [...GENERATING_STATUSES]
        : [...GENERATING_STATUSES, 'pending_approval'];
    const inFlight = await this.prisma.run.findFirst({
      where: { status: { in: blocking } },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight) {
      // Manual Generate: replace the stuck/waiting draft instead of hard-blocking.
      if (triggeredBy === 'manual') {
        await this.supersedeInFlight(inFlight.id, inFlight.status);
      } else {
        throw Object.assign(
          new Error(
            'A run is already in flight (generating or awaiting approval)',
          ),
          { status: 409 },
        );
      }
    }

    const run = await this.prisma.run.create({
      data: {
        triggeredBy,
        status: selectedStory ? 'writing' : 'collecting',
      },
    });

    void this.execute(run.id, selectedStory).catch((err) => {
      this.log.error(`Run ${run.id} failed`, err);
    });

    return run;
  }

  /** Mark generating rows failed when the in-process pipeline is idle. */
  private async clearOrphanedGenerating() {
    if (this.running) return;
    const result = await this.prisma.run.updateMany({
      where: { status: { in: [...GENERATING_STATUSES] } },
      data: {
        status: 'failed',
        errorMessage: 'Cleared orphaned run (pipeline was not running)',
      },
    });
    if (result.count > 0) {
      this.log.warn(`Cleared ${result.count} orphaned generating run(s)`);
      await this.prisma.draft.updateMany({
        where: {
          status: 'pending',
          run: { status: 'failed' },
        },
        data: { status: 'rejected', feedback: 'orphaned' },
      });
    }
  }

  private async supersedeInFlight(runId: string, status: string) {
    this.log.log(`Superseding in-flight run ${runId} (${status})`);
    if (GENERATING_STATUSES.includes(status as never)) {
      this.cancelled.add(runId);
    }
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: status === 'pending_approval' ? 'skipped' : 'failed',
        errorMessage:
          status === 'pending_approval'
            ? 'Superseded by a new Generate'
            : 'Superseded / stopped for a new Generate',
      },
    });
    await this.prisma.draft.updateMany({
      where: { runId, status: 'pending' },
      data: {
        status: 'rejected',
        feedback:
          status === 'pending_approval' ? 'superseded' : 'stopped',
      },
    });
  }

  async cancel(runId?: string) {
    const target =
      runId ||
      this.activeRunId ||
      (
        await this.prisma.run.findFirst({
          where: {
            status: { in: [...GENERATING_STATUSES, 'pending_approval'] },
          },
          orderBy: { createdAt: 'desc' },
        })
      )?.id;

    if (!target) {
      throw Object.assign(new Error('No in-flight run to stop'), {
        status: 404,
      });
    }

    this.cancelled.add(target);
    this.running = false;
    if (this.activeRunId === target) this.activeRunId = null;

    const existing = await this.prisma.run.findUnique({
      where: { id: target },
      select: { status: true },
    });
    const asSkip = existing?.status === 'pending_approval';

    await this.prisma.run.update({
      where: { id: target },
      data: {
        status: asSkip ? 'skipped' : 'failed',
        errorMessage: asSkip ? 'Skipped by user' : 'Stopped by user',
      },
    });
    await this.prisma.draft.updateMany({
      where: { runId: target, status: 'pending' },
      data: {
        status: 'rejected',
        feedback: asSkip ? 'skipped' : 'stopped',
      },
    });

    return { ok: true, runId: target };
  }

  async regenerate(runId: string, feedback?: string) {
    if (this.running) {
      throw Object.assign(new Error('Pipeline already running'), {
        status: 409,
      });
    }

    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { drafts: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
    if (!run.winnerJson) {
      throw Object.assign(new Error('Run has no winner to regenerate from'), {
        status: 400,
      });
    }

    const latest = run.drafts[0];
    if (latest && latest.status === 'pending') {
      await this.prisma.draft.update({
        where: { id: latest.id },
        data: { status: 'rejected', feedback: feedback || null },
      });
    }

    this.cancelled.delete(runId);
    await this.prisma.run.update({
      where: { id: runId },
      data: { status: 'regenerating', errorMessage: null },
    });

    void this.executeRegen(runId, feedback).catch((err) => {
      this.log.error(`Regen ${runId} failed`, err);
    });

    return this.prisma.run.findUnique({ where: { id: runId } });
  }

  private async execute(
    runId: string,
    selectedStory?: {
      title: string;
      link: string;
      why_it_matters?: string;
      angle?: string;
      trend_score?: number;
      prediction_reason?: string;
    },
  ) {
    this.running = true;
    this.activeRunId = runId;
    this.cancelled.delete(runId);
    try {
      let winner: {
        title: string;
        link: string;
        why_it_matters: string;
        angle: string;
        trend_score?: number;
        prediction_reason?: string;
      };
      let contentType: ContentType | undefined;

      const used = await loadUsedIndex(this.prisma);
      const runRow = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { triggeredBy: true },
      });
      if (runRow?.triggeredBy === 'cron') {
        const securityToday = await this.securityPostedToday();
        contentType = contentTypeForHour(
          cronWindowStatus().istHour,
          securityToday,
        );
      }

      if (selectedStory) {
        if (used.matchesStory(selectedStory.title, selectedStory.link)) {
          throw new Error(
            'That story was already used. Pick a different source.',
          );
        }
        winner = {
          title: selectedStory.title,
          link: selectedStory.link,
          why_it_matters:
            selectedStory.why_it_matters ||
            'Selected by user for a developer-focused LinkedIn post',
          angle: selectedStory.angle || 'developer takeaway',
          trend_score: selectedStory.trend_score ?? 8,
          prediction_reason:
            selectedStory.prediction_reason || 'Manually selected from candidates',
        };
        const events = await this.sourceEvents.normalizeStories([
          {
            title: winner.title,
            link: winner.link,
            summary: winner.why_it_matters,
            source: 'manual',
          },
        ]);
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            collectedAt: new Date(),
            storyCount: 1,
            winnerJson: { winner, selected: true, contentType: winner.angle },
          },
        });
        await this.logStep(runId, 'select', winner.title, { winner });

        const intel = await this.buildIntelligence(runId, winner, {
          sourceEventId: events[0]?.id,
        });

        await this.setStatus(runId, 'writing');
        await this.assertNotCancelled(runId);
        const written = await this.writeWithQualityGate(
          runId,
          winner,
          used,
          undefined,
          contentType || normalizeBucket(winner.angle),
          intel,
        );
        await this.persistDraftAndFinalize(
          runId,
          winner,
          written,
          1,
          contentType || normalizeBucket(winner.angle),
          intel,
        );
      } else {
        await this.setStatus(runId, 'collecting');
        await this.assertNotCancelled(runId);
        if (this.githubIngest.configured()) {
          try {
            const gh = await this.githubIngest.ingestRecent(8);
            await this.logStep(runId, 'github_ingest', `${gh.ingested} commits`, gh);
          } catch (err) {
            this.log.warn(
              `GitHub ingest skipped: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        const { stories, collectedAt } = await this.news.collect(40);
        await this.assertNotCancelled(runId);
        const eventRows = await this.sourceEvents.normalizeStories(stories);
        const eventByLink = new Map(
          eventRows.map((e) => [e.story.link, e.id] as const),
        );
        const fresh = used.unusedStories(stories);
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            collectedAt,
            storyCount: fresh.length,
          },
        });
        await this.logStep(runId, 'collect', `${fresh.length} unused of ${stories.length}`, {
          count: fresh.length,
          collected: stories.length,
          sourceEvents: eventRows.length,
        });

        if (fresh.length === 0) {
          throw new Error(
            'No unused stories left — every candidate was already posted or drafted',
          );
        }

        await this.setStatus(runId, 'researching');
        await this.assertNotCancelled(runId);
        const research = await this.agents.research(fresh, contentType);
        await this.assertNotCancelled(runId);
        const unusedTop = used.unusedStories(research.data.top_stories);
        if (unusedTop.length === 0) {
          throw new Error(
            'Research only returned stories that were already used',
          );
        }
        const researchData = { top_stories: unusedTop };
        await this.prisma.run.update({
          where: { id: runId },
          data: { topStoriesJson: researchData },
        });
        await this.logStep(
          runId,
          'research',
          unusedTop.slice(0, 3).map((s) => s.title).join('; '),
          { ...researchData, contentType },
          research.latencyMs,
        );

        await this.setStatus(runId, 'ranking');
        await this.assertNotCancelled(runId);
        const rank = await this.agents.rank(
          researchData,
          used.summary(),
          contentType,
        );
        await this.assertNotCancelled(runId);
        winner = this.pickUniqueWinner(rank.data, unusedTop, used, contentType);

        const scored = await this.selectScoredWinner(
          runId,
          winner,
          unusedTop,
          used,
          contentType,
          eventByLink,
        );
        winner = scored.winner;
        const intel = scored.intel;

        await this.prisma.run.update({
          where: { id: runId },
          data: {
            winnerJson: {
              ...rank.data,
              winner,
              contentType: contentType || winner.angle,
              intelligence: {
                pillar: intel.pillar,
                contentScore: intel.contentScore,
                selectedAngle: intel.selectedAngle,
                selectedHook: intel.selectedHook,
                opportunityId: intel.opportunityId,
              },
            },
          },
        });
        await this.logStep(
          runId,
          'rank',
          `${contentType || winner.angle}: ${winner.title}`,
          {
            ...rank.data,
            winner,
            contentType,
            intelligence: intel,
          },
          rank.latencyMs,
        );

        await this.setStatus(runId, 'writing');
        await this.assertNotCancelled(runId);
        const written = await this.writeWithQualityGate(
          runId,
          winner,
          used,
          undefined,
          contentType || normalizeBucket(winner.angle),
          intel,
        );
        await this.persistDraftAndFinalize(
          runId,
          winner,
          written,
          1,
          contentType || normalizeBucket(winner.angle),
          intel,
        );
      }
    } catch (err) {
      if (err instanceof PipelineCancelledError) {
        this.log.log(`Run ${runId} cancelled`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const current = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (
        current?.status !== 'failed' &&
        current?.status !== 'rejected' &&
        current?.status !== 'published'
      ) {
        const rejected =
          /opportunity rejected|quality gate rejected/i.test(message);
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            status: rejected ? 'rejected' : 'failed',
            errorMessage: message,
          },
        });
      }
    } finally {
      this.cancelled.delete(runId);
      if (this.activeRunId === runId) this.activeRunId = null;
      this.running = false;
    }
  }

  private async executeRegen(runId: string, feedback?: string) {
    this.running = true;
    this.activeRunId = runId;
    try {
      const run = await this.prisma.run.findUnique({ where: { id: runId } });
      if (!run?.winnerJson) throw new Error('Missing winner');
      await this.assertNotCancelled(runId);

      const winnerJson = run.winnerJson as {
        winner: {
          title: string;
          link: string;
          why_it_matters: string;
          angle: string;
          trend_score?: number;
        };
        contentType?: ContentType;
      };
      const winner = winnerJson.winner;
      const version =
        (await this.prisma.draft.count({ where: { runId } })) + 1;

      const used = await loadUsedIndex(this.prisma);
      const intel = await this.buildIntelligence(runId, winner);
      const written = await this.writeWithQualityGate(
        runId,
        winner,
        used,
        feedback,
        winnerJson.contentType || normalizeBucket(winner.angle),
        intel,
      );
      await this.persistDraftAndFinalize(
        runId,
        winner,
        written,
        version,
        winnerJson.contentType || normalizeBucket(winner.angle),
        intel,
      );
    } catch (err) {
      if (err instanceof PipelineCancelledError) {
        this.log.log(`Regen ${runId} cancelled`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const current = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (
        current?.status !== 'failed' &&
        current?.status !== 'rejected' &&
        current?.status !== 'published'
      ) {
        const rejected =
          /opportunity rejected|quality gate rejected/i.test(message);
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            status: rejected ? 'rejected' : 'failed',
            errorMessage: message,
          },
        });
      }
    } finally {
      this.cancelled.delete(runId);
      if (this.activeRunId === runId) this.activeRunId = null;
      this.running = false;
    }
  }

  private async assertNotCancelled(runId: string) {
    if (this.cancelled.has(runId)) throw new PipelineCancelledError();
    const row = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { status: true, errorMessage: true },
    });
    if (
      row?.status === 'failed' &&
      row.errorMessage === 'Stopped by user'
    ) {
      this.cancelled.add(runId);
      throw new PipelineCancelledError();
    }
  }

  private async attachImage(
    runId: string,
    draftId: string,
    opts: {
      prompt: string;
      hook: string;
      source: string;
      postText?: string;
      version: number;
      category?: ContentType | string;
    },
  ) {
    try {
      await this.setStatus(runId, 'imaging');
      await this.assertNotCancelled(runId);
      const imageUrl = await this.deapi.generateAndStore({
        prompt: opts.prompt,
        hook: opts.hook,
        source: opts.source,
        postText: opts.postText,
        category: opts.category,
        key: `drafts/${runId}/v${opts.version}.png`,
      });
      await this.prisma.draft.update({
        where: { id: draftId },
        data: { imageUrl },
      });
      await this.logStep(runId, 'image', imageUrl || 'unavailable', {
        imageUrl,
        mode:
          this.config.get('DEAPI_USE_AI') === 'true' ? 'deapi' : 'quote-card',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Image skipped after text saved: ${msg}`);
      await this.logStep(runId, 'image', 'skipped', { error: msg });
    } finally {
      const current = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true, triggeredBy: true },
      });
      if (current?.status === 'imaging') {
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            status:
              current.triggeredBy === 'cron'
                ? 'auto_approved'
                : 'pending_approval',
          },
        });
      }
    }
  }

  private async postsPublishedToday() {
    return this.prisma.run.count({
      where: {
        status: 'published',
        publishedAt: { gte: startOfIstDay() },
      },
    });
  }

  private async securityPostedToday() {
    const since = startOfIstDay();
    const runs = await this.prisma.run.findMany({
      where: {
        status: 'published',
        publishedAt: { gte: since },
      },
      select: { winnerJson: true },
    });
    return runs.some((r) => {
      const w = r.winnerJson as {
        contentType?: string;
        winner?: { angle?: string };
      } | null;
      const type = w?.contentType || w?.winner?.angle;
      return normalizeBucket(type) === 'security-bug';
    });
  }

  private pickUniqueWinner(
    rank: {
      winner: {
        title: string;
        link: string;
        why_it_matters: string;
        angle: string;
        trend_score?: number;
        prediction_reason?: string;
      };
      runners_up?: Array<{ title: string }>;
    },
    topStories: Array<{
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
      trend_score: number;
    }>,
    used: UsedIndex,
    contentType?: ContentType,
  ) {
    const byTitle = new Map(topStories.map((s) => [s.title, s]));
    const candidates = [
      rank.winner,
      ...(rank.runners_up || [])
        .map((r) => byTitle.get(r.title))
        .filter((s): s is (typeof topStories)[number] => Boolean(s)),
      ...topStories,
    ];
    const preferred = contentType
      ? storyBucketsFor(contentType)
      : undefined;
    const fallback = contentType
      ? fallbackBuckets(contentType)
      : undefined;

    const pickFrom = (allow: string[] | undefined) => {
      const seen = new Set<string>();
      for (const c of candidates) {
        const key = `${c.link}|${c.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (used.matchesStory(c.title, c.link)) continue;
        if (allow && !allow.includes(normalizeBucket(c.angle))) continue;
        return {
          title: c.title,
          link: c.link,
          why_it_matters: c.why_it_matters,
          angle: c.angle,
          trend_score:
            'trend_score' in c ? c.trend_score : rank.winner.trend_score,
          prediction_reason:
            'prediction_reason' in c && c.prediction_reason
              ? String(c.prediction_reason)
              : contentType
                ? `Unique unused ${contentType} story`
                : 'Unique unused story',
        };
      }
      return null;
    };

    const hit =
      pickFrom(preferred) || pickFrom(fallback) || pickFrom(undefined);
    if (!hit) {
      throw new Error(
        'No unused story left to post — all ranked candidates were already used',
      );
    }
    return hit;
  }

  private async writeUniquePost(
    runId: string,
    winner: {
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
      trend_score?: number;
      prediction_reason?: string;
    },
    used: UsedIndex,
    feedback?: string,
    contentType?: ContentType,
    intel?: IntelligenceContext,
  ) {
    const rawWhy = winner.why_it_matters || '';
    winner = {
      ...winner,
      link: articleUrlFromHn(rawWhy) || winner.link,
      why_it_matters: isHnMetadata(rawWhy)
        ? cleanStoryBlurb(winner.title, '')
        : cleanStoryBlurb(
            winner.title,
            rawWhy
              .replace(/^\s*Angle:\s*.+$/gim, '')
              .replace(/^\s*Preferred hook:\s*.+$/gim, '')
              .trim(),
          ),
      angle: intel?.selectedAngle || winner.angle,
    };
    const articleExcerpt = await fetchArticleExcerpt(winner.link);
    if (articleExcerpt) {
      await this.logStep(
        runId,
        'article_context',
        `${articleExcerpt.length} chars`,
        { link: winner.link, excerptPreview: articleExcerpt.slice(0, 240) },
      );
    }
    const drafts = await this.agents.writeDrafts(
      winner,
      { hooks: used.hooks },
      contentType,
      articleExcerpt,
    );
    await this.logStep(runId, 'content', '2 essay drafts', drafts.data, drafts.latencyMs);

    const samples = await this.activeSamples();
    let profileNote = '';
    try {
      const profile = await this.writingProfile.getActive();
      profileNote = this.writingProfile.formatForPrompt(profile);
    } catch {
      /* optional */
    }
    const voiceOpts = {
      drafts: drafts.data,
      winner,
      voiceSamples: samples,
      articleExcerpt,
      feedback: [
        feedback,
        intel
          ? [
              `Writing brief (do NOT paste these labels into the post):`,
              `- Angle to follow: ${intel.selectedAngle}`,
              `- Preferred hook energy (rewrite in your words, do not paste verbatim): ${intel.selectedHook}`,
              `- Pillar: ${intel.pillar}`,
              `- Format: ${intel.format || 'engineering_story'}`,
            ].join('\n')
          : null,
        profileNote || null,
        'Write a LONG original essay (~500-700 words): specific facts from the article, your builder interpretation, one concrete action. Include Primary source URL. Never use generic boilerplate.',
      ]
        .filter(Boolean)
        .join('\n'),
      avoidPosts: used.posts.slice(0, 8),
    };
    let voice = await this.agents.applyVoice(voiceOpts);
    await this.logStep(runId, 'voice', voice.data.hook, voice.data, voice.latencyMs);

    if (used.matchesPost(voice.data.post_text, voice.data.hook)) {
      voice = await this.agents.applyVoice({
        ...voiceOpts,
        feedback: [
          voiceOpts.feedback,
          'Rewrite from scratch. New hook, new examples, new closing question. Do not echo any previous post or title.',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      await this.logStep(
        runId,
        'voice',
        `retry ${voice.data.hook}`,
        voice.data,
        voice.latencyMs,
      );
      if (used.matchesHook(voice.data.hook)) {
        throw new Error(
          'Generated title/hook was too similar to an earlier one — skipped to keep the feed unique',
        );
      }
      if (used.matchesPost(voice.data.post_text, voice.data.hook)) {
        this.log.warn(
          `Post body similarity soft-warn for run ${runId}; keeping draft after rewrite retry`,
        );
        await this.logStep(runId, 'voice', 'similarity soft-warn', {
          hook: voice.data.hook,
        });
      }
    }

    const polished = polishDraft({
      postText: voice.data.post_text,
      hook: voice.data.hook,
      hashtags: voice.data.hashtags,
      category: contentType || normalizeBucket(winner.angle),
      avoidHashtags: used.recentHashtags(14),
      sourceLink: voice.data.source_link || winner.link,
      sourceTitle: voice.data.source_title || winner.title,
    });
    voice = {
      ...voice,
      data: {
        ...voice.data,
        post_text: polished.postText,
        hook: polished.hook,
        hashtags: polished.hashtags,
        image_prompt: polished.postText
          ? voice.data.image_prompt.replace(/\u0000/g, '')
          : voice.data.image_prompt,
        source_title: voice.data.source_title.replace(/\u0000/g, ''),
        source_link: voice.data.source_link.replace(/\u0000/g, ''),
      },
    };

    return { voice, drafts };
  }

  private async buildIntelligence(
    runId: string,
    winner: {
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
    },
    opts?: { sourceEventId?: string },
  ): Promise<IntelligenceContext> {
    const scored = await this.opportunityScorer.scoreAndPersist({
      runId,
      sourceEventId: opts?.sourceEventId,
      title: winner.title,
      link: winner.link,
      why: winner.why_it_matters,
      angle: winner.angle,
    });
    if (scored.rejected) {
      await this.logStep(runId, 'opportunity_reject', winner.title, {
        contentScore: scored.contentScore,
        reasons: scored.reasons,
      });
      throw new Error(
        `Opportunity rejected: ${scored.reasons.join('; ') || 'low content score'}`,
      );
    }

    const boosts = await this.pillars.diversityBoosts(20);
    const feedbackHints = await this.feedback.cautiousPillarHints();
    for (const [p, b] of Object.entries(feedbackHints.boosts)) {
      boosts[p as ContentPillar] = (boosts[p as ContentPillar] || 0) + (b || 0);
    }

    let pillar = scored.pillar;
    // Soft preference: if boost for another pillar is high, keep scored pillar
    // but note diversity in angle generation.
    const diversityNote = `Recent pillar boosts: ${JSON.stringify(boosts)}`;

    const angles = await this.angleHook.generateAngles({
      title: winner.title,
      why: winner.why_it_matters,
      pillar,
      formatHint: scored.format,
      diversityNote,
    });
    const used = await loadUsedIndex(this.prisma);
    const hooks = await this.angleHook.generateHooks({
      title: winner.title,
      angle: angles.selected.angle,
      pillar,
      avoidHooks: used.hooks.slice(0, 20),
    });

    if (scored.opportunityId) {
      await this.prisma.contentOpportunity.update({
        where: { id: scored.opportunityId },
        data: {
          status: 'selected',
          pillar,
          format: angles.selected.format || scored.format,
          anglesJson: angles.angles,
          hooksJson: hooks.hooks,
          selectedAngle: angles.selected.angle,
          selectedHook: hooks.selected.text,
        },
      });
    }

    await this.logStep(runId, 'intelligence', hooks.selected.text, {
      contentScore: scored.contentScore,
      pillar,
      angle: angles.selected.angle,
      hook: hooks.selected.text,
      boosts,
    });

    return {
      opportunityId: scored.opportunityId,
      sourceEventId: opts?.sourceEventId,
      pillar,
      format: angles.selected.format || scored.format,
      contentScore: scored.contentScore,
      scoresJson: scored.scores,
      selectedAngle: angles.selected.angle,
      selectedHook: hooks.selected.text,
      anglesJson: angles.angles,
      hooksJson: hooks.hooks,
      diversityBoosts: boosts,
    };
  }

  private async selectScoredWinner(
    runId: string,
    primary: {
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
      trend_score?: number;
      prediction_reason?: string;
    },
    topStories: Array<{
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
      trend_score: number;
    }>,
    used: UsedIndex,
    contentType: ContentType | undefined,
    eventByLink: Map<string, string>,
  ): Promise<{
    winner: typeof primary;
    intel: IntelligenceContext;
  }> {
    const ordered = [
      primary,
      ...topStories.filter(
        (s) => s.link !== primary.link && s.title !== primary.title,
      ),
    ];
    const errors: string[] = [];
    for (const candidate of ordered.slice(0, 6)) {
      if (used.matchesStory(candidate.title, candidate.link)) continue;
      try {
        const intel = await this.buildIntelligence(runId, candidate, {
          sourceEventId: eventByLink.get(candidate.link),
        });
        return {
          winner: {
            title: candidate.title,
            link: candidate.link,
            why_it_matters: candidate.why_it_matters,
            angle: candidate.angle,
            trend_score:
              'trend_score' in candidate
                ? candidate.trend_score
                : primary.trend_score,
            prediction_reason:
              'prediction_reason' in candidate &&
              (candidate as { prediction_reason?: string }).prediction_reason
                ? String(
                    (candidate as { prediction_reason?: string })
                      .prediction_reason,
                  )
                : contentType
                  ? `Scored unused ${contentType} story`
                  : 'Scored unused story',
          },
          intel,
        };
      } catch (err) {
        errors.push(
          `${candidate.title}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new Error(
      `All candidates failed opportunity gate: ${errors.slice(0, 3).join(' | ')}`,
    );
  }

  private async writeWithQualityGate(
    runId: string,
    winner: {
      title: string;
      link: string;
      why_it_matters: string;
      angle: string;
      trend_score?: number;
      prediction_reason?: string;
    },
    used: UsedIndex,
    feedback: string | undefined,
    contentType: ContentType | undefined,
    intel: IntelligenceContext,
  ) {
    let regen = 0;
    let lastFeedback = feedback;
    const max = this.contentConfig.maxRegenerationAttempts();

    while (true) {
      await this.assertNotCancelled(runId);
      const { voice, drafts } = await this.writeUniquePost(
        runId,
        winner,
        used,
        lastFeedback,
        contentType,
        intel,
      );

      const qc = await this.qualityGate.evaluate({
        postText: voice.data.post_text,
        hook: voice.data.hook,
        sourceTitle: voice.data.source_title || winner.title,
        sourceLink: voice.data.source_link || winner.link,
        pillar: intel.pillar,
        used,
        regenerationCount: regen,
      });

      await this.logStep(runId, 'quality_gate', qc.decision, {
        ...qc,
        regenerationCount: regen,
      });

      if (qc.decision === 'approved') {
        return {
          voice,
          drafts,
          qc,
          regenerationCount: regen,
        };
      }

      if (qc.decision === 'rejected' || regen >= max) {
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            status: 'rejected',
            errorMessage: (qc.reasons || []).join('; ') || 'QC rejected',
          },
        });
        throw new Error(
          `Quality gate rejected after ${regen} regen(s): ${(qc.reasons || []).join('; ')}`,
        );
      }

      regen += 1;
      lastFeedback = [
        lastFeedback,
        qc.feedback,
        `QC failed: ${(qc.reasons || []).join('; ')}. Rewrite for authenticity and specificity.`,
      ]
        .filter(Boolean)
        .join('\n');
      await this.setStatus(runId, 'regenerating');
    }
  }

  private async persistDraftAndFinalize(
    runId: string,
    winner: {
      title: string;
      link: string;
    },
    written: {
      voice: {
        data: {
          chosen_style: string;
          hook: string;
          post_text: string;
          image_prompt: string;
          hashtags: string[];
          source_title: string;
          source_link: string;
        };
      };
      drafts: { data: unknown };
      qc: {
        decision: string;
        reasons: string[];
        qualityScore?: number;
        authenticityScore?: number;
        aiGenericnessScore?: number;
        repetitionScore?: number;
        scores?: unknown;
        feedback?: string;
      };
      regenerationCount: number;
    },
    version: number,
    contentType: ContentType | string | undefined,
    intel: IntelligenceContext,
  ) {
    const runRow = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { triggeredBy: true },
    });
    const isCron = runRow?.triggeredBy === 'cron';
    const draftStatus = isCron ? 'auto_approved' : 'pending';
    const runStatus = isCron ? 'auto_approved' : 'pending_approval';

    const { voice, drafts, qc, regenerationCount } = written;
    const draft = await this.prisma.draft.create({
      data: {
        runId,
        version,
        chosenStyle: voice.data.chosen_style,
        hook: voice.data.hook,
        postText: voice.data.post_text,
        imagePrompt: voice.data.image_prompt,
        imageUrl: null,
        hashtags: voice.data.hashtags,
        sourceTitle: voice.data.source_title || winner.title,
        sourceLink: voice.data.source_link || winner.link,
        threeDraftsJson: drafts.data as object,
        status: draftStatus,
      },
    });

    await this.prisma.contentDraftMeta.create({
      data: {
        draftId: draft.id,
        runId,
        pillar: intel.pillar,
        format: intel.format,
        contentScore: intel.contentScore,
        qualityScore: qc.qualityScore,
        authenticityScore: qc.authenticityScore,
        aiGenericnessScore: qc.aiGenericnessScore,
        repetitionScore: qc.repetitionScore,
        diversityScore: intel.diversityBoosts
          ? Object.values(intel.diversityBoosts).reduce((a, b) => a + b, 0)
          : undefined,
        scoresJson: {
          opportunity: intel.scoresJson as object,
          quality: qc.scores as object,
        },
        decision: isCron ? 'approved' : 'pending_review',
        decisionReasons: qc.reasons || [],
        decisionJson: {
          decision: qc.decision,
          reasons: qc.reasons,
          qualityScore: qc.qualityScore,
          authenticityScore: qc.authenticityScore,
          aiGenericnessScore: qc.aiGenericnessScore,
          repetitionScore: qc.repetitionScore,
          contentScore: intel.contentScore,
          pillar: intel.pillar,
          selectedAngle: intel.selectedAngle,
          selectedHook: intel.selectedHook,
          triggeredBy: runRow?.triggeredBy,
        },
        selectedAngle: intel.selectedAngle,
        selectedHook: intel.selectedHook,
        promptVersions: {
          scorer: 'event-scorer-v1',
          angle: 'angle-v1',
          hook: 'hook-v1',
          draft: 'draft-v1',
          qc: 'qc-v1',
        } as object,
        regenerationCount,
      },
    });

    await this.attachTweet(runId, draft.id, {
      postText: voice.data.post_text,
      hook: voice.data.hook,
      sourceTitle: voice.data.source_title || winner.title,
      sourceLink: voice.data.source_link || winner.link,
    });

    await this.setStatus(runId, runStatus);

    await this.attachImage(runId, draft.id, {
      prompt: voice.data.image_prompt,
      hook: voice.data.hook,
      source: voice.data.source_title || winner.title,
      postText: voice.data.post_text,
      version,
      category: contentType,
    });

    await this.finalizeRun(runId);
  }

  private async finishRun(runId: string) {
    await this.finalizeRun(runId);
  }

  /**
   * Cron (+ CRON_AUTO_PUBLISH): QC-passed drafts auto-publish.
   * Manual Generate: always wait for Approve / Reject / Regen.
   */
  private async finalizeRun(runId: string) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { triggeredBy: true, status: true, winnerJson: true },
    });
    if (!run) return;

    const cronAuto =
      run.triggeredBy === 'cron' &&
      this.config.get('CRON_AUTO_PUBLISH') !== 'false';

    if (!cronAuto) {
      await this.prisma.run.update({
        where: { id: runId },
        data: { status: 'pending_approval' },
      });
      await this.prisma.draft.updateMany({
        where: {
          runId,
          status: { in: ['auto_approved', 'pending', 'approved'] },
        },
        data: { status: 'pending' },
      });
      await this.notifyDraftReady(runId);
      return;
    }

    if (
      run.status !== 'pending_approval' &&
      run.status !== 'auto_approved' &&
      run.status !== 'imaging'
    ) {
      const fresh = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (
        fresh?.status !== 'pending_approval' &&
        fresh?.status !== 'auto_approved'
      ) {
        return;
      }
    }

    if (!this.linkedin.configured()) {
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorMessage: 'Cron auto-publish needs LinkedIn connected',
        },
      });
      return;
    }

    await this.prisma.draft.updateMany({
      where: { runId, status: { in: ['auto_approved', 'pending', 'approved'] } },
      data: { status: 'pending' },
    });
    await this.prisma.run.update({
      where: { id: runId },
      data: { status: 'pending_approval' },
    });

    try {
      const result = await this.linkedin.publishPendingRun(runId);
      await this.logStep(runId, 'publish', result.urn || 'published', result);

      const draft = await this.prisma.draft.findFirst({
        where: { runId },
        orderBy: { version: 'desc' },
      });
      const meta = draft
        ? await this.prisma.contentDraftMeta.findUnique({
            where: { draftId: draft.id },
          })
        : null;
      if (meta) {
        await this.prisma.contentDraftMeta.update({
          where: { id: meta.id },
          data: {
            decision: 'published',
            decisionReasons: [
              ...(meta.decisionReasons || []),
              'cron-auto-published',
            ],
          },
        });
      }
      await this.feedback.recordPublishStub({
        runId,
        draftId: draft?.id,
        linkedinPostUrn: result.urn,
        pillar: meta?.pillar,
        format: meta?.format,
        hook: draft?.hook,
        contentScore: meta?.contentScore,
        qualityScore: meta?.qualityScore,
        publishedAt: new Date(),
      });

      this.log.log(`Cron auto-publish OK for run ${runId}`);
      const w = run.winnerJson as {
        winner?: { title?: string; link?: string };
      } | null;
      const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
      const title = w?.winner?.title || runId;
      const article = w?.winner?.link?.trim();
      await this.telegram.ping(
        [
          'Published to LinkedIn (cron).',
          title,
          meta?.pillar ? `Pillar: ${meta.pillar}` : null,
          meta?.qualityScore != null ? `Quality: ${meta.qualityScore}` : null,
          article ? `Article: ${article}` : null,
          appUrl,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Cron auto-publish failed for ${runId}: ${msg}`);
      await this.telegram.ping(`Cron publish failed: ${msg}`);
    }
  }

  /** @deprecated use finalizeRun */
  private async finalizeAutonomous(runId: string) {
    await this.finalizeRun(runId);
  }

  /** @deprecated use finalizeRun */
  private async maybeAutoPublish(runId: string) {
    await this.finalizeRun(runId);
  }

  private async activeSamples() {
    return this.prisma.voiceSample.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 3,
      select: { title: true, body: true },
    });
  }

  private async setStatus(runId: string, status: string) {
    await this.assertNotCancelled(runId);
    await this.prisma.run.update({ where: { id: runId }, data: { status } });
  }

  private async logStep(
    runId: string,
    step: string,
    inputExcerpt: string,
    outputJson: unknown,
    latencyMs?: number,
  ) {
    await this.prisma.pipelineLog.create({
      data: {
        runId,
        step,
        inputExcerpt: inputExcerpt.slice(0, 2000),
        outputJson: outputJson as object,
        latencyMs: latencyMs ?? null,
      },
    });
  }

  /** Public: send (or regenerate) the tweet version to Telegram. */
  async resendTweetTelegram(runId: string, regenerate = false) {
    const draft = await this.prisma.draft.findFirst({
      where: { runId },
      orderBy: { version: 'desc' },
    });
    if (!draft?.postText) {
      throw new Error('No draft text to compress into a tweet');
    }

    let tweet = draft.tweetText?.trim() || '';
    if (regenerate || !tweet) {
      const result = await this.agents.writeTweet({
        postText: draft.postText,
        hook: draft.hook || draft.sourceTitle || 'Update',
        sourceTitle: draft.sourceTitle || undefined,
        sourceLink: draft.sourceLink || undefined,
      });
      tweet = result.tweet;
      await this.prisma.draft.update({
        where: { id: draft.id },
        data: { tweetText: tweet },
      });
      await this.logStep(runId, 'tweet', tweet, result, result.latencyMs);
    }

    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    const sent = await this.telegram.sendDraftWithTweet({
      appUrl,
      runId,
      hook: draft.hook || undefined,
      tweet,
      sourceTitle: draft.sourceTitle || undefined,
    });
    if (!sent.ok) {
      throw new Error(sent.error || 'Telegram send failed');
    }
    return { ok: true, tweet };
  }

  private async attachTweet(
    runId: string,
    draftId: string,
    opts: {
      postText: string;
      hook: string;
      sourceTitle?: string;
      sourceLink?: string;
    },
  ) {
    try {
      const result = await this.agents.writeTweet(opts);
      await this.prisma.draft.update({
        where: { id: draftId },
        data: { tweetText: result.tweet },
      });
      await this.logStep(runId, 'tweet', result.tweet, result, result.latencyMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Tweet skipped: ${msg}`);
      await this.logStep(runId, 'tweet', 'skipped', { error: msg });
    }
  }

  private async notifyDraftReady(runId: string) {
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    const draft = await this.prisma.draft.findFirst({
      where: { runId },
      orderBy: { version: 'desc' },
      select: {
        hook: true,
        tweetText: true,
        postText: true,
        sourceTitle: true,
        sourceLink: true,
      },
    });

    let tweet = draft?.tweetText?.trim() || '';
    if (!tweet && draft?.postText) {
      const result = await this.agents.writeTweet({
        postText: draft.postText,
        hook: draft.hook || draft.sourceTitle || 'Update',
        sourceTitle: draft.sourceTitle || undefined,
        sourceLink: draft.sourceLink || undefined,
      });
      tweet = result.tweet;
    }

    if (tweet) {
      const sent = await this.telegram.sendDraftWithTweet({
        appUrl,
        runId,
        hook: draft?.hook || undefined,
        tweet,
        sourceTitle: draft?.sourceTitle || undefined,
      });
      if (!sent.ok) {
        this.log.warn(`Telegram tweet notify failed: ${sent.error}`);
      }
      return;
    }

    const title = draft?.sourceTitle?.trim();
    const article = draft?.sourceLink?.trim();
    const hook = draft?.hook?.trim();
    await this.telegram.ping(
      [
        'LinkedIn draft ready.',
        title ? title : null,
        hook ? hook : null,
        article ? `Article: ${article}` : null,
        `Open: ${appUrl}`,
        `Run: ${runId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}
