import { Logger } from '@nestjs/common';

const log = new Logger('ArticleContext');

/**
 * Best-effort article text for writing context.
 * Never throws — returns empty string on failure.
 */
export async function fetchArticleExcerpt(
  url: string,
  maxChars = 3500,
): Promise<string> {
  const link = (url || '').trim();
  if (!/^https?:\/\//i.test(link)) return '';

  try {
    const res = await fetch(link, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent':
          'LinkedInDailyPoster/1.0 (+local content research; respectful fetch)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      log.warn(`Article fetch ${res.status} for ${link}`);
      return '';
    }
    const html = await res.text();
    return htmlToPlainExcerpt(html, maxChars);
  } catch (err) {
    log.warn(
      `Article fetch failed for ${link}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
}

export function htmlToPlainExcerpt(html: string, maxChars: number): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const articleMatch =
    /<article[\s\S]*?<\/article>/i.exec(withoutNoise)?.[0] || withoutNoise;

  const text = articleMatch
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const sp = cut.lastIndexOf('. ');
  return (sp > maxChars * 0.5 ? cut.slice(0, sp + 1) : cut).trim();
}

export function looksLikeBoilerplate(post: string): boolean {
  const lower = post.toLowerCase();
  return (
    lower.includes('this piece walks through a concrete builder problem') ||
    lower.includes('focus on the named technique, tool, or release') ||
    lower.includes('what single action are you taking from this story before the next standup') ||
    (lower.includes('do this week: open the article') &&
      lower.includes('primary source'))
  );
}
