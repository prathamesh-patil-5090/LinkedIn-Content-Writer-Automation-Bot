import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import { PrismaService } from '../prisma/prisma.module';
import { articleUrlFromHn, cleanStoryBlurb } from './hn-item';

export type CollectedStory = {
  title: string;
  link: string;
  summary: string;
  published_at?: string;
  source: string;
  relevance?: number;
};

/** Boost JS/AI releases more than generic CVEs so the feed is not all security. */
const BOOST = [
  ['javascript', 6],
  ['typescript', 6],
  ['js library', 8],
  ['npm package', 8],
  ['npm ', 5],
  ['node.js', 5],
  ['nodejs', 5],
  [' react', 5],
  ['next.js', 7],
  ['nextjs', 7],
  ['vue', 4],
  ['svelte', 4],
  ['deno', 4],
  ['bun ', 4],
  ['vite', 5],
  ['webpack', 3],
  ['eslint', 3],
  ['prettier', 3],
  ['tailwind', 3],
  ['zod', 4],
  ['prisma', 4],
  ['library', 4],
  ['package', 3],
  ['sdk', 5],
  ['api ', 3],
  ['open source', 3],
  ['github', 2],
  ['release', 6],
  ['changelog', 5],
  [' ga ', 4],
  [' lts', 4],
  ['copilot', 7],
  ['claude', 5],
  ['cursor', 6],
  ['chatgpt', 4],
  ['openai', 4],
  ['llm', 6],
  [' rag', 6],
  ['ai coding', 8],
  ['ai tool', 7],
  ['ai agent', 6],
  ['devtools', 5],
  ['developer tool', 6],
  ['cve-', 5],
  ['cve ', 4],
  ['vulnerability', 4],
  ['rce', 4],
  ['zero-day', 5],
  ['0-day', 5],
  ['security bug', 5],
  ['security flaw', 4],
  ['exploit', 3],
  ['patch', 3],
  ['xss', 3],
  ['sql injection', 3],
  ['supply chain', 4],
  ['npm malware', 6],
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
  ['wordpress', 6],
  [' sap ', 6],
  ['log4j', 5],
  ['subscribe to snyk', 8],
  ['patch alerts', 6],
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
        const feed = await this.parseRss(source.rssUrl);
        for (const item of feed.items || []) {
          const title = (item.title || '').trim();
          const raw = `${item.content || ''} ${item.contentSnippet || ''} ${item.summary || ''}`;
          const article = articleUrlFromHn(raw);
          const link = (article || item.link || item.guid || '').trim();
          if (!title || !link) continue;
          const summary = cleanStoryBlurb(title, raw);
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
        if (/^HN /i.test(source.name)) {
          try {
            const hn = await this.fetchHnAlgolia(source.name);
            stories.push(...hn);
            this.log.log(`HN Algolia fallback filled ${hn.length} for ${source.name}`);
          } catch (hnErr) {
            this.log.warn(
              `HN Algolia fallback failed for ${source.name}: ${
                hnErr instanceof Error ? hnErr.message : hnErr
              }`,
            );
          }
        }
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

  private async parseRss(url: string) {
    try {
      return await this.parser.parseURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/502|503|429|ECONNRESET|timeout/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 600));
      return this.parser.parseURL(url);
    }
  }

  private async fetchHnAlgolia(sourceName: string): Promise<CollectedStory[]> {
    const frontpage = /frontpage/i.test(sourceName);
    const query = /javascript/i.test(sourceName)
      ? 'JavaScript TypeScript React Node'
      : /security/i.test(sourceName)
        ? 'CVE vulnerability RCE exploit'
        : /ai/i.test(sourceName)
          ? 'LLM Copilot Claude RAG'
          : '';
    const url = frontpage
      ? 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25'
      : `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LinkedInDailyPoster/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HN Algolia HTTP ${res.status}`);
    const json = (await res.json()) as {
      hits?: Array<{
        title?: string;
        url?: string;
        objectID?: string;
        created_at?: string;
        story_text?: string;
      }>;
    };
    return (json.hits || [])
      .filter((h) => h.title)
      .map((h) => {
        const title = (h.title || '').trim();
        const link =
          h.url ||
          `https://news.ycombinator.com/item?id=${h.objectID || ''}`;
        const summary = cleanStoryBlurb(title, h.story_text || '');
        return {
          title,
          link,
          summary,
          published_at: h.created_at,
          source: sourceName,
          relevance: this.score(`${title} ${summary} ${sourceName}`),
        };
      });
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
