import { PrismaService } from '../prisma/prisma.module';

export type UsedStory = { title: string; link: string };

export class UsedIndex {
  constructor(
    readonly stories: UsedStory[],
    readonly posts: string[],
    readonly hooks: string[],
  ) {}

  matchesStory(title: string, link: string) {
    return this.stories.some((s) => isSameStory(title, link, s.title, s.link));
  }

  matchesPost(text: string, hook?: string) {
    if (hook && this.hooks.some((h) => similarText(hook, h, 0.72))) return true;
    return this.posts.some((p) => similarText(text, p, 0.5));
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
  return value
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
  return jaccard(significantTokens(titleA), significantTokens(titleB)) >= 0.62;
}

export function similarText(a: string, b: string, threshold: number): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 80 && nb.length > 80 && na.slice(0, 160) === nb.slice(0, 160)) {
    return true;
  }
  return jaccard(significantTokens(a), significantTokens(b)) >= threshold;
}

type WinnerJson = {
  winner?: { title?: string; link?: string };
  title?: string;
  link?: string;
};

export async function loadUsedIndex(prisma: PrismaService): Promise<UsedIndex> {
  const runs = await prisma.run.findMany({
    select: {
      winnerJson: true,
      drafts: {
        select: {
          sourceLink: true,
          sourceTitle: true,
          postText: true,
          hook: true,
        },
      },
    },
  });

  const stories: UsedStory[] = [];
  const posts: string[] = [];
  const hooks: string[] = [];

  for (const run of runs) {
    const w = run.winnerJson as WinnerJson | null;
    const title = w?.winner?.title || w?.title;
    const link = w?.winner?.link || w?.link;
    if (title || link) {
      stories.push({ title: title || '', link: link || '' });
    }
    for (const d of run.drafts) {
      if (d.sourceTitle || d.sourceLink) {
        stories.push({
          title: d.sourceTitle || title || '',
          link: d.sourceLink || link || '',
        });
      }
      if (d.postText) posts.push(d.postText);
      if (d.hook) hooks.push(d.hook);
    }
  }

  return new UsedIndex(stories, posts, hooks);
}
