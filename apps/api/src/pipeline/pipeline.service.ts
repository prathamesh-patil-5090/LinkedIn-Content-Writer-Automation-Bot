import { Injectable, Logger } from '@nestjs/common';
import { GENERATING_STATUSES } from '@ldp/shared';
import {
  fallbackBuckets,
  normalizeBucket,
  storyBucketsFor,
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
import {
  contentTypeForHour,
  cronWindowStatus,
  startOfIstDay,
} from '../scheduler/cron-window';

class PipelineCancelledError extends Error {
  constructor() {
    super('Stopped by user');
    this.name = 'PipelineCancelledError';
  }
}

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

    const blocking =
      triggeredBy === 'cron'
        ? [...GENERATING_STATUSES]
        : [...GENERATING_STATUSES, 'pending_approval'];
    const inFlight = await this.prisma.run.findFirst({
      where: { status: { in: blocking } },
    });
    if (inFlight) {
      throw Object.assign(
        new Error('A run is already in flight (generating or awaiting approval)'),
        { status: 409 },
      );
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

  async cancel(runId?: string) {
    const target =
      runId ||
      this.activeRunId ||
      (
        await this.prisma.run.findFirst({
          where: { status: { in: [...GENERATING_STATUSES] } },
          orderBy: { createdAt: 'desc' },
        })
      )?.id;

    if (!target) {
      throw Object.assign(new Error('No generating run to stop'), {
        status: 404,
      });
    }

    this.cancelled.add(target);
    this.running = false;

    await this.prisma.run.update({
      where: { id: target },
      data: { status: 'failed', errorMessage: 'Stopped by user' },
    });
    await this.prisma.draft.updateMany({
      where: { runId: target, status: 'pending' },
      data: { status: 'rejected', feedback: 'stopped' },
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
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            collectedAt: new Date(),
            storyCount: 1,
            winnerJson: { winner, selected: true, contentType: winner.angle },
          },
        });
        await this.logStep(runId, 'select', winner.title, { winner });
      } else {
        await this.setStatus(runId, 'collecting');
        await this.assertNotCancelled(runId);
        const { stories, collectedAt } = await this.news.collect(40);
        await this.assertNotCancelled(runId);
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
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            winnerJson: { ...rank.data, winner, contentType: contentType || winner.angle },
          },
        });
        await this.logStep(
          runId,
          'rank',
          `${contentType || winner.angle}: ${winner.title}`,
          { ...rank.data, winner, contentType },
          rank.latencyMs,
        );
      }

      await this.setStatus(runId, 'writing');
      await this.assertNotCancelled(runId);
      const { voice, drafts } = await this.writeUniquePost(
        runId,
        winner,
        used,
        undefined,
        contentType || normalizeBucket(winner.angle),
      );
      await this.assertNotCancelled(runId);

      const draft = await this.prisma.draft.create({
        data: {
          runId,
          version: 1,
          chosenStyle: voice.data.chosen_style,
          hook: voice.data.hook,
          postText: voice.data.post_text,
          imagePrompt: voice.data.image_prompt,
          imageUrl: null,
          hashtags: voice.data.hashtags,
          sourceTitle: voice.data.source_title || winner.title,
          sourceLink: voice.data.source_link || winner.link,
          threeDraftsJson: drafts.data,
          status: 'pending',
        },
      });

      await this.setStatus(runId, 'pending_approval');

      await this.attachImage(runId, draft.id, {
        prompt: voice.data.image_prompt,
        hook: voice.data.hook,
        source: voice.data.source_title || winner.title,
        version: 1,
      });
      await this.finishRun(runId);
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
      if (current?.status !== 'failed') {
        await this.prisma.run.update({
          where: { id: runId },
          data: { status: 'failed', errorMessage: message },
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
      const { voice, drafts } = await this.writeUniquePost(
        runId,
        winner,
        used,
        feedback,
        winnerJson.contentType || normalizeBucket(winner.angle),
      );
      await this.assertNotCancelled(runId);

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
          threeDraftsJson: drafts.data,
          status: 'pending',
          feedback: feedback || null,
        },
      });

      await this.setStatus(runId, 'pending_approval');
      await this.notifyDraftReady(runId);

      await this.attachImage(runId, draft.id, {
        prompt: voice.data.image_prompt,
        hook: voice.data.hook,
        source: voice.data.source_title || winner.title,
        version,
      });
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
      if (current?.status !== 'failed') {
        await this.prisma.run.update({
          where: { id: runId },
          data: { status: 'failed', errorMessage: message },
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
    opts: { prompt: string; hook: string; source: string; version: number },
  ) {
    try {
      await this.setStatus(runId, 'imaging');
      await this.assertNotCancelled(runId);
      const imageUrl = await this.deapi.generateAndStore({
        prompt: opts.prompt,
        hook: opts.hook,
        source: opts.source,
        key: `drafts/${runId}/v${opts.version}.png`,
      });
      await this.prisma.draft.update({
        where: { id: draftId },
        data: { imageUrl },
      });
      await this.logStep(runId, 'image', imageUrl || 'unavailable', {
        imageUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Image skipped after text saved: ${msg}`);
      await this.logStep(runId, 'image', 'skipped', { error: msg });
    } finally {
      const current = await this.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (current?.status === 'imaging') {
        await this.prisma.run.update({
          where: { id: runId },
          data: { status: 'pending_approval' },
        });
      }
    }
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
  ) {
    const drafts = await this.agents.writeDrafts(
      winner,
      { hooks: used.hooks },
      contentType,
    );
    await this.logStep(runId, 'content', '2 essay drafts', drafts.data, drafts.latencyMs);

    const samples = await this.activeSamples();
    const voiceOpts = {
      drafts: drafts.data,
      winner,
      voiceSamples: samples,
      feedback,
      avoidPosts: used.posts.slice(0, 8),
    };
    let voice = await this.agents.applyVoice(voiceOpts);
    await this.logStep(runId, 'voice', voice.data.hook, voice.data, voice.latencyMs);

    if (used.matchesPost(voice.data.post_text, voice.data.hook)) {
      voice = await this.agents.applyVoice({
        ...voiceOpts,
        feedback: [
          feedback,
          'Rewrite from scratch. New hook, new examples, new closing question. Do not echo any previous post.',
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
      if (used.matchesPost(voice.data.post_text, voice.data.hook)) {
        throw new Error(
          'Generated post was too similar to an earlier one — skipped to keep the feed unique',
        );
      }
    }

    return { voice, drafts };
  }

  private async finishRun(runId: string) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { triggeredBy: true, status: true },
    });
    if (run?.triggeredBy === 'cron') {
      await this.maybeAutoPublish(runId);
      return;
    }
    await this.notifyDraftReady(runId);
  }

  private async maybeAutoPublish(runId: string) {
    if (this.config.get('CRON_AUTO_PUBLISH') === 'false') {
      await this.notifyDraftReady(runId);
      return;
    }
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { triggeredBy: true, status: true, winnerJson: true },
    });
    if (run?.triggeredBy !== 'cron' || run.status !== 'pending_approval') {
      return;
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
    try {
      const result = await this.linkedin.publishPendingRun(runId);
      await this.logStep(runId, 'publish', result.urn || 'published', result);
      this.log.log(`Auto-published run ${runId}`);
      const w = run.winnerJson as { winner?: { title?: string } } | null;
      const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
      await this.telegram.ping(
        `Published to LinkedIn (cron).\n${w?.winner?.title || runId}\n${appUrl}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Auto-publish failed for ${runId}: ${msg}`);
      await this.telegram.ping(`Cron publish failed: ${msg}`);
    }
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

  private async notifyDraftReady(runId: string) {
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    await this.telegram.ping(
      `LinkedIn draft ready.\nOpen: ${appUrl}\nRun: ${runId}`,
    );
  }
}
