import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import type { CollectedStory } from '../news/news.service';

@Injectable()
export class SourceEventsService {
  private readonly log = new Logger(SourceEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Upsert RSS/HN stories as SourceEvent rows. Returns event ids in input order. */
  async normalizeStories(
    stories: CollectedStory[],
    sourceHint?: string,
  ): Promise<Array<{ id: string; story: CollectedStory }>> {
    const out: Array<{ id: string; story: CollectedStory }> = [];
    for (const story of stories) {
      const source = this.mapSource(story.source || sourceHint || 'rss');
      const externalId = this.externalId(source, story);
      try {
        const row = await this.prisma.sourceEvent.upsert({
          where: {
            source_externalId: { source, externalId },
          },
          create: {
            source,
            project: null,
            eventType: 'story',
            title: story.title.slice(0, 500),
            description: (story.summary || '').slice(0, 4000),
            link: story.link,
            externalId,
            payloadJson: {
              published_at: story.published_at,
              relevance: story.relevance,
              source_name: story.source,
            },
            occurredAt: story.published_at
              ? new Date(story.published_at)
              : undefined,
          },
          update: {
            title: story.title.slice(0, 500),
            description: (story.summary || '').slice(0, 4000),
            link: story.link,
            payloadJson: {
              published_at: story.published_at,
              relevance: story.relevance,
              source_name: story.source,
            },
          },
        });
        out.push({ id: row.id, story });
      } catch (err) {
        this.log.warn(
          `SourceEvent upsert failed for ${story.title}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return out;
  }

  async createGithubEvent(opts: {
    repo: string;
    sha: string;
    message: string;
    url?: string;
    author?: string;
    occurredAt?: Date;
    project?: string;
  }) {
    const externalId = `commit:${opts.repo}:${opts.sha}`;
    return this.prisma.sourceEvent.upsert({
      where: {
        source_externalId: { source: 'github', externalId },
      },
      create: {
        source: 'github',
        project: opts.project || opts.repo,
        eventType: 'commit',
        title: opts.message.split('\n')[0].slice(0, 200),
        description: opts.message.slice(0, 4000),
        link: opts.url,
        externalId,
        payloadJson: {
          repo: opts.repo,
          sha: opts.sha,
          author: opts.author,
        },
        technicalContext: `GitHub commit on ${opts.repo}`,
        occurredAt: opts.occurredAt,
      },
      update: {
        title: opts.message.split('\n')[0].slice(0, 200),
        description: opts.message.slice(0, 4000),
        link: opts.url,
      },
    });
  }

  private mapSource(raw: string): string {
    const s = raw.toLowerCase();
    if (s.includes('hacker') || s === 'hn') return 'hn';
    if (s.includes('github')) return 'github';
    return 'rss';
  }

  private externalId(source: string, story: CollectedStory): string {
    const basis = (story.link || story.title).trim().toLowerCase();
    return createHash('sha1').update(`${source}|${basis}`).digest('hex').slice(0, 40);
  }
}
