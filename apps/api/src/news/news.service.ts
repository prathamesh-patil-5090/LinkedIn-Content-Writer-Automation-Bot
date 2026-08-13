import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import { PrismaService } from '../prisma/prisma.module';

export type CollectedStory = {
  title: string;
  link: string;
  summary: string;
  published_at?: string;
  source: string;
  relevance?: number;
};

/** Strong boost — JS libs, AI coding tools, security bugs */
const BOOST = [
  ['javascript', 6],
  ['typescript', 6],
  ['js library', 8],
  ['npm package', 8],
  ['npm ', 5],
  ['node.js', 5],
  ['nodejs', 5],
  [' react', 5],
  ['next.js', 6],
  ['nextjs', 6],
  ['vue', 4],
  ['svelte', 4],
  ['deno', 4],
  ['bun ', 4],
  ['vite', 4],
  ['webpack', 3],
  ['eslint', 3],
  ['prettier', 3],
  ['tailwind', 3],
  ['zod', 3],
  ['prisma', 3],
  ['library', 4],
  ['package', 3],
  ['sdk', 4],
  ['api ', 3],
  ['open source', 3],
  ['github', 2],
  ['copilot', 7],
  ['claude', 5],
  ['cursor', 5],
  ['chatgpt', 4],
  ['openai', 4],
  ['llm', 6],
  [' rag', 6],
  ['ai coding', 8],
  ['ai tool', 7],
  ['ai agent', 6],
  ['devtools', 5],
  ['developer tool', 6],
  ['cve-', 10],
  ['cve ', 9],
  ['vulnerability', 8],
  ['rce', 8],
  ['zero-day', 8],
  ['0-day', 8],
  ['security bug', 9],
  ['security flaw', 8],
  ['exploit', 6],
  ['patch', 4],
  ['xss', 6],
  ['sql injection', 7],
  ['supply chain', 7],
  ['npm malware', 10],
] as const;

const PENALIZE = [
  ['podcast', 12],
  ['episode', 8],
  ['listen now', 10],
  ['valuation', 8],
  ['raises $', 8],
  ['funding round', 8],
  ['series a', 6],
  ['series b', 6],
  ['acquires', 4],
  ['mathematica', 10],
  ['wolfram', 8],
  ['sports', 10],
  ['celebrity', 10],
] as const;

@Injectable()
export class NewsService {
  private readonly log = new Logger(NewsService.name);
  private readonly parser = new Parser({
    timeout: 15_000,
    headers: { 'User-Agent': 'LinkedInDailyPoster/1.0' },
  });

  constructor(private readonly prisma: PrismaService) {}

  async collect(cap = 40): Promise<{
    stories: CollectedStory[];
    collectedAt: Date;
  }> {
    const sources = await this.prisma.newsSource.findMany({
      where: { isActive: true },
    });

    const stories: CollectedStory[] = [];
    for (const source of sources) {
      try {
        const feed = await this.parser.parseURL(source.rssUrl);
        for (const item of feed.items || []) {
          const title = (item.title || '').trim();
          const link = (item.link || item.guid || '').trim();
          if (!title || !link) continue;
          const summary = (
            item.contentSnippet ||
            item.content ||
            item.summary ||
            ''
          )
            .replace(/<[^>]+>/g, '')
            .slice(0, 500);
          const relevance = this.score(`${title} ${summary} ${source.name}`);
          stories.push({
            title,
            link,
            summary,
            published_at: item.isoDate || item.pubDate || undefined,
            source: source.name,
            relevance,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`RSS failed for ${source.name}: ${msg}`);
      }
    }

    const ranked = this.dedupe(stories).sort(
      (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0),
    );

    // Prefer clearly relevant; keep a small tail so LLM still has options
    const strong = ranked.filter((s) => (s.relevance ?? 0) >= 4);
    const finalStories = (
      strong.length >= 8 ? strong : ranked.filter((s) => (s.relevance ?? 0) > 0)
    ).slice(0, cap);

    return {
      stories: finalStories.length ? finalStories : ranked.slice(0, cap),
      collectedAt: new Date(),
    };
  }

  private score(text: string): number {
    const hay = ` ${text.toLowerCase()} `;
    let score = 0;
    for (const [hint, pts] of BOOST) {
      if (hay.includes(hint)) score += pts;
    }
    for (const [hint, pts] of PENALIZE) {
      if (hay.includes(hint)) score -= pts;
    }
    return score;
  }

  private dedupe(stories: CollectedStory[]): CollectedStory[] {
    const seenUrl = new Set<string>();
    const seenTitle = new Set<string>();
    const out: CollectedStory[] = [];
    for (const s of stories) {
      const urlKey = s.link.replace(/\/$/, '').toLowerCase();
      const titleKey = s.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;
      seenUrl.add(urlKey);
      seenTitle.add(titleKey);
      out.push(s);
    }
    return out;
  }
}
