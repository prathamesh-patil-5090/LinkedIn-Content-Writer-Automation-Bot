import type { ContentType } from '@ldp/shared';
import { formatLinkedInPost, splitHashtagFooter, stripNullBytes } from './format';
import { mergeHashtags } from './hashtags';

const LINKEDIN_SOFT_MAX = 2900;

/** Scheme URLs, www. URLs, and bare host/path links (github.com/owner/repo, lnkd.in/x). */
const LINK_RE =
  /(?:https?:\/\/|www\.)[^\s)>\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|to|in|ai|co|app|sh|me|blog)\/[^\s)>\]]+/gi;

/** Site names LinkedIn would auto-link when written as a bare domain. */
const SITE_NAMES: Array<[RegExp, string]> = [
  [/\bdev\.to\b/gi, 'DEV'],
  [/\bgithub\.com\b/gi, 'GitHub'],
  [/\bnews\.ycombinator\.com\b/gi, 'Hacker News'],
  [/\bmedium\.com\b/gi, 'Medium'],
];

const CREDIT_PREFIX = 'Source: ';

export function polishDraft(opts: {
  postText: string;
  hook: string;
  hashtags: string[];
  category?: ContentType | string;
  avoidHashtags?: string[];
  /** Used only to credit the source by name. The URL never enters the post. */
  sourceLink?: string | null;
  sourceTitle?: string | null;
}) {
  const split = splitHashtagFooter(opts.postText);
  const hashtags = mergeHashtags(
    [...opts.hashtags, ...split.tags],
    opts.category,
    opts.avoidHashtags || [],
  );
  const existing = splitSourceCredit(stripLinks(split.body));
  const credit =
    existing.credit || sourceCredit(opts.sourceLink, opts.sourceTitle);
  const footer = [credit, hashtags.join(' ')].filter(Boolean).join('\n\n');
  // Soft LinkedIn ceiling only — never mid-word ellipsis on the hook/title.
  const body = softCap(existing.body, LINKEDIN_SOFT_MAX - footer.length - 2);
  // The credit is attached after formatting so names like some_user keep
  // their underscores and the closing question still gets its italics.
  const postText = [formatLinkedInPost(body), footer]
    .filter(Boolean)
    .join('\n\n');
  return {
    postText: stripNullBytes(postText),
    hook: stripNullBytes(
      formatLinkedInPost(opts.hook.trim()).split('\n')[0] || opts.hook.trim(),
    ),
    hashtags,
  };
}

export function findLinks(text: string): string[] {
  return text.match(LINK_RE) || [];
}

/**
 * LinkedIn throttles posts that carry external links, so the body has none.
 * Lines that only existed to introduce a link ("Primary source:") go too.
 */
export function stripLinks(text: string): string {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    let next = line;
    if (findLinks(line).length) {
      next = line
        .replace(LINK_RE, '')
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trimEnd();
      if (!next.trim() || /[:(\-–—]$/.test(next.trim())) {
        // "Primary source:" on the line above pointed at the link we just cut.
        if (lines.length && /:\s*$/.test(lines[lines.length - 1])) lines.pop();
        continue;
      }
    }
    for (const [re, name] of SITE_NAMES) next = next.replace(re, name);
    lines.push(next);
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split a trailing `Source: "…"` credit line off the body. */
export function splitSourceCredit(body: string): {
  body: string;
  credit: string;
} {
  const lines = body.replace(/\s+$/, '').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last < 0 || !lines[last].trim().startsWith(`${CREDIT_PREFIX}"`)) {
    return { body: body.trim(), credit: '' };
  }
  return {
    body: lines.slice(0, last).join('\n').trim(),
    credit: lines[last].trim(),
  };
}

/**
 * Name the source so readers can search for it, e.g.
 * `Source: "Building a cross-framework engine" by some_user on DEV`.
 */
export function sourceCredit(
  sourceLink?: string | null,
  sourceTitle?: string | null,
): string {
  const title = (sourceTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  const origin = sourceOrigin(sourceLink);
  return `${CREDIT_PREFIX}"${title}"${origin ? ` ${origin}` : ''}`;
}

function sourceOrigin(sourceLink?: string | null): string {
  let url: URL;
  try {
    url = new URL((sourceLink || '').trim());
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'dev.to') return parts[0] ? `by ${parts[0]} on DEV` : 'on DEV';
  if (host === 'github.com') {
    return parts.length >= 2
      ? `in ${parts[0]}/${parts[1]} on GitHub`
      : 'on GitHub';
  }
  if (host === 'medium.com') {
    return parts[0]?.startsWith('@')
      ? `by ${parts[0].slice(1)} on Medium`
      : 'on Medium';
  }
  if (host === 'news.ycombinator.com') return 'on Hacker News';

  // blog.cloudflare.com → Cloudflare, react.dev → React
  const labels = host.split('.');
  let name = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  if ((name === 'co' || name === 'com') && labels.length >= 3) {
    name = labels[labels.length - 3];
  }
  return name ? `via ${name.charAt(0).toUpperCase()}${name.slice(1)}` : '';
}

function softCap(body: string, max: number) {
  const budget = Math.max(200, max);
  if (body.length <= budget) return body;
  const cut = body.slice(0, budget);
  const sp = cut.lastIndexOf('\n');
  const sp2 = cut.lastIndexOf(' ');
  const at = sp > budget * 0.6 ? sp : sp2 > budget * 0.5 ? sp2 : budget;
  return cut.slice(0, at).trim();
}
