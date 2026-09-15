import type { ContentType } from '@ldp/shared';
import { formatLinkedInPost, splitHashtagFooter, stripNullBytes } from './format';
import { mergeHashtags, withHashtagFooter } from './hashtags';

const LINKEDIN_SOFT_MAX = 2900;

export function polishDraft(opts: {
  postText: string;
  hook: string;
  hashtags: string[];
  category?: ContentType | string;
  avoidHashtags?: string[];
  sourceLink?: string | null;
  sourceTitle?: string | null;
}) {
  const fromBody = splitHashtagFooter(opts.postText).tags;
  const hashtags = mergeHashtags(
    [...opts.hashtags, ...fromBody],
    opts.category,
    opts.avoidHashtags || [],
  );
  let body = withHashtagFooter(opts.postText, hashtags);
  body = ensureSourceLink(body, opts.sourceLink, opts.sourceTitle);
  // Soft LinkedIn ceiling only — never mid-word ellipsis on the hook/title.
  body = softCapLinkedIn(body, LINKEDIN_SOFT_MAX);
  return {
    postText: stripNullBytes(formatLinkedInPost(body)),
    hook: stripNullBytes(
      formatLinkedInPost(opts.hook.trim()).split('\n')[0] || opts.hook.trim(),
    ),
    hashtags,
  };
}

/** Append a bare article URL so LinkedIn makes it clickable. */
export function ensureSourceLink(
  postText: string,
  sourceLink?: string | null,
  sourceTitle?: string | null,
) {
  const link = (sourceLink || '').trim();
  if (!link || !/^https?:\/\//i.test(link)) return postText;
  if (postText.includes(link)) return postText;

  const { body, tags } = splitHashtagFooter(postText);
  const label = (sourceTitle || '').trim();
  const line = label
    ? `Primary source (${label}):\n${link}`
    : `Primary source:\n${link}`;
  const withLink = `${body.trim()}\n\n${line}`.trim();
  return tags.length ? `${withLink}\n\n${tags.join(' ')}` : withLink;
}

function softCapLinkedIn(text: string, max: number) {
  if (text.length <= max) return text;
  const { body, tags } = splitHashtagFooter(text);
  const tagBlock = tags.length ? `\n\n${tags.join(' ')}` : '';
  const budget = Math.max(200, max - tagBlock.length);
  if (body.length <= budget) return text;
  const cut = body.slice(0, budget);
  const sp = cut.lastIndexOf('\n');
  const sp2 = cut.lastIndexOf(' ');
  const at = sp > budget * 0.6 ? sp : sp2 > budget * 0.5 ? sp2 : budget;
  return `${cut.slice(0, at).trim()}${tagBlock}`;
}
