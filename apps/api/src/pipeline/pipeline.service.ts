import { Injectable, Logger } from '@nestjs/common';
import { GENERATING_STATUSES } from '@ldp/shared';
import { PrismaService } from '../prisma/prisma.module';
import { NewsService } from '../news/news.service';
import { AgentsService } from '../agents/agents.service';
import { PixazoService } from '../media/pixazo.service';
import { TelegramService } from '../notifications/telegram.service';
import { ConfigService } from '@nestjs/config';

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
    private readonly pixazo: PixazoService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
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

    const inFlight = await this.prisma.run.findFirst({
      where: { status: { in: [...GENERATING_STATUSES, 'pending_approval'] } },
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

      if (selectedStory) {
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
            winnerJson: { winner, selected: true },
          },
        });
        await this.logStep(runId, 'select', winner.title, { winner });
      } else {
        await this.setStatus(runId, 'collecting');
        await this.assertNotCancelled(runId);
        const { stories, collectedAt } = await this.news.collect(40);
        await this.assertNotCancelled(runId);
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            collectedAt,
            storyCount: stories.length,
          },
        });
        await this.logStep(runId, 'collect', `${stories.length} stories`, {
          count: stories.length,
        });

        if (stories.length === 0) {
          throw new Error('No stories collected from RSS feeds');
        }

        await this.setStatus(runId, 'researching');
        await this.assertNotCancelled(runId);
        const research = await this.agents.research(stories);
        await this.assertNotCancelled(runId);
        await this.prisma.run.update({
          where: { id: runId },
          data: { topStoriesJson: research.data },
        });
        await this.logStep(
          runId,
          'research',
          stories.slice(0, 3).map((s) => s.title).join('; '),
          research.data,
          research.latencyMs,
        );

        await this.setStatus(runId, 'ranking');
        await this.assertNotCancelled(runId);
        const rank = await this.agents.rank(research.data);
        await this.assertNotCancelled(runId);
        const duplicate = await this.isDuplicateWinner(rank.data.winner.title);
        winner = rank.data.winner;
        if (duplicate && research.data.top_stories.length > 1) {
          const alt = research.data.top_stories.find(
            (s) => s.title !== winner.title,
          );
          if (alt) {
            winner = {
              title: alt.title,
              link: alt.link,
              why_it_matters: alt.why_it_matters,
              trend_score: alt.trend_score,
              angle: alt.angle,
              prediction_reason: 'Skipped duplicate of recent published title',
            };
          }
        }
        await this.prisma.run.update({
          where: { id: runId },
          data: { winnerJson: { ...rank.data, winner } },
        });
        await this.logStep(
          runId,
          'rank',
          winner.title,
          { ...rank.data, winner },
          rank.latencyMs,
        );
      }

      await this.setStatus(runId, 'writing');
      await this.assertNotCancelled(runId);
      const drafts = await this.agents.writeDrafts(winner);
      await this.assertNotCancelled(runId);
      await this.logStep(runId, 'content', '3 drafts', drafts.data, drafts.latencyMs);

      const samples = await this.activeSamples();
      const voice = await this.agents.applyVoice({
        drafts: drafts.data,
        winner,
        voiceSamples: samples,
      });
      await this.assertNotCancelled(runId);
      await this.logStep(runId, 'voice', voice.data.hook, voice.data, voice.latencyMs);

      await this.setStatus(runId, 'imaging');
      await this.assertNotCancelled(runId);
      const imageUrl = await this.pixazo.generateAndStore({
        prompt: voice.data.image_prompt,
        key: `drafts/${runId}/v1.png`,
      });
      await this.assertNotCancelled(runId);
      await this.logStep(runId, 'image', imageUrl || 'unavailable', {
        imageUrl,
      });

      await this.prisma.draft.create({
        data: {
          runId,
          version: 1,
          chosenStyle: voice.data.chosen_style,
          hook: voice.data.hook,
          postText: voice.data.post_text,
          imagePrompt: voice.data.image_prompt,
          imageUrl,
          hashtags: voice.data.hashtags,
          sourceTitle: voice.data.source_title || winner.title,
          sourceLink: voice.data.source_link || winner.link,
          threeDraftsJson: drafts.data,
          status: 'pending',
        },
      });

      await this.setStatus(runId, 'pending_approval');
      await this.notifyDraftReady(runId);
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
      };
      const winner = winnerJson.winner;
      const version =
        (await this.prisma.draft.count({ where: { runId } })) + 1;

      const drafts = await this.agents.writeDrafts(winner);
      await this.assertNotCancelled(runId);
      const samples = await this.activeSamples();
      const voice = await this.agents.applyVoice({
        drafts: drafts.data,
        winner,
        voiceSamples: samples,
        feedback,
      });
      await this.assertNotCancelled(runId);
      await this.logStep(runId, 'voice', voice.data.hook, voice.data, voice.latencyMs);

      await this.setStatus(runId, 'imaging');
      const imageUrl = await this.pixazo.generateAndStore({
        prompt: voice.data.image_prompt,
        key: `drafts/${runId}/v${version}.png`,
      });
      await this.assertNotCancelled(runId);

      await this.prisma.draft.create({
        data: {
          runId,
          version,
          chosenStyle: voice.data.chosen_style,
          hook: voice.data.hook,
          postText: voice.data.post_text,
          imagePrompt: voice.data.image_prompt,
          imageUrl,
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

  private async activeSamples() {
    return this.prisma.voiceSample.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 8,
      select: { title: true, body: true },
    });
  }

  private async isDuplicateWinner(title: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.run.findMany({
      where: {
        status: 'published',
        publishedAt: { gte: since },
      },
      select: { winnerJson: true },
    });
    const norm = title.toLowerCase().replace(/\s+/g, ' ').trim();
    return recent.some((r) => {
      const w = r.winnerJson as { winner?: { title?: string } } | null;
      const t = w?.winner?.title?.toLowerCase().replace(/\s+/g, ' ').trim();
      return t === norm;
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
