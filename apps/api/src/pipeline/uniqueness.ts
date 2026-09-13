import { PrismaService } from '../prisma/prisma.module';
import { fromUnicodeVariant } from '@ldp/shared';

export type UsedStory = { title: string; link: string };

export class UsedIndex {
  constructor(
    readonly stories: UsedStory[],
    readonly posts: string[],
    readonly hooks: string[],
    /** Flattened recent hashtags (most recent first). */
    readonly hashtags: string[] = [],
  ) {}

  matchesStory(title: string, link: string) {
    return this.stories.some((s) => isSameStory(title, link, s.title, s.link));
  }

  matchesPost(text: string, hook?: string) {
    if (hook && this.matchesHook(hook)) return true;
    return this.posts.some((p) => similarText(text, p, 0.72));
  }

  matchesHook(hook: string) {
    if (!hook?.trim()) return false;
    if (this.hooks.some((h) => similarHook(hook, h))) return true;
    return this.stories.some((s) => similarHook(hook, s.title));
  }

  /** Hashtags from the last N posts (for rotation). */
  recentHashtags(limitPosts = 12): string[] {
    // hashtags array is already flattened newest-first per post in loadUsedIndex
    return this.hashtags.slice(0, limitPosts * 8);
  }

  unusedStories<T extends { title: string; link: string }>(stories: T[]): T[] {
    return stories.filter((s) => !this.matchesStory(s.title, s.link));
  }

  summary(limit = 24) {
    return this.stories.slice(0, limit).map((s) => ({
      title: s.title.slice(0, 140),
      link: s.link,
    }));
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

export function normalizeText(value: string): string {
  return fromUnicodeVariant(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\w]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'to',
  'in',
  'on',
  'for',
  'with',
  'how',
  'what',
  'why',
  'is',
  'are',
  'this',
  'that',
  'from',
  'new',
  'now',
  'its',
  'it',
  'as',
  'at',
  'be',
  'by',
]);

export function significantTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function isSameStory(
  titleA: string,
  linkA: string,
  titleB: string,
  linkB: string,
): boolean {
  if (linkA && linkB && normalizeUrl(linkA) === normalizeUrl(linkB)) return true;
  const na = normalizeText(titleA);
  const nb = normalizeText(titleB);
  if (na && na === nb) return true;
  // Stricter than before so near-duplicate titles don't reappear.
  return jaccard(significantTokens(titleA), significantTokens(titleB)) >= 0.5;
}

export function similarText(a: string, b: string, threshold: number): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (
    na.length > 140 &&
    nb.length > 140 &&
    na.slice(0, 200) === nb.slice(0, 200)
  ) {
    return true;
  }
  return jaccard(significantTokens(a), significantTokens(b)) >= threshold;
}

/** Hooks / titles are short — catch near-duplicates aggressively. */
export function similarHook(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    if (shorter >= 18) return true;
  }
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size <= 5 || tb.size <= 5) {
    return jaccard(ta, tb) >= 0.72;
  }
  return jaccard(ta, tb) >= 0.68;
}

type WinnerJson = {
  winner?: { title?: string; link?: string };
  title?: string;
  link?: string;
};

export async function loadUsedIndex(prisma: PrismaService): Promise<UsedIndex> {
  // Stories: any run that ranked a winner (even skipped/failed) — stop title reuse.
  const allRuns = await prisma.run.findMany({
    select: {
      status: true,
      winnerJson: true,
      createdAt: true,
      drafts: {
        orderBy: { version: 'desc' },
        select: {
          status: true,
          sourceLink: true,
          sourceTitle: true,
          postText: true,
          hook: true,
          hashtags: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const stories: UsedStory[] = [];
  const posts: string[] = [];
  const hooks: string[] = [];
  const hashtags: string[] = [];

  const feedStatuses = new Set([
    'published',
    'pending_approval',
    'publishing',
    'regenerating',
  ]);

  for (const run of allRuns) {
    const w = run.winnerJson as WinnerJson | null;
    const title = w?.winner?.title || w?.title;
    const link = w?.winner?.link || w?.link;
    if (title || link) {
      stories.push({ title: title || '', link: link || '' });
    }

    const countForFeed = feedStatuses.has(run.status);
    for (const d of run.drafts) {
      if (d.sourceTitle || d.sourceLink) {
        stories.push({
          title: d.sourceTitle || title || '',
          link: d.sourceLink || link || '',
        });
      }
      if (d.hook) {
        // Block duplicate titles/hooks even from skipped runs.
        hooks.push(d.hook);
        stories.push({ title: d.hook, link: d.sourceLink || link || '' });
      }
      if (!countForFeed) continue;
      if (d.status !== 'pending' && d.status !== 'approved') continue;
      if (d.postText) posts.push(d.postText);
      if (d.hashtags?.length) hashtags.push(...d.hashtags);
    }
  }

  return new UsedIndex(stories, posts, hooks, hashtags);
}
