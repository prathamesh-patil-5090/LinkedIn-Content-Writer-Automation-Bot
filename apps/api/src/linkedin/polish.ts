import type { ContentType } from '@ldp/shared';
import { formatLinkedInPost, splitHashtagFooter, stripNullBytes } from './format';
import { mergeHashtags, withHashtagFooter } from './hashtags';

export function polishDraft(opts: {
  postText: string;
  hook: string;
  hashtags: string[];
  category?: ContentType | string;
}) {
  const fromBody = splitHashtagFooter(opts.postText).tags;
  const hashtags = mergeHashtags(
    [...opts.hashtags, ...fromBody],
    opts.category,
  );
  const withTags = withHashtagFooter(opts.postText, hashtags);
  return {
    postText: stripNullBytes(formatLinkedInPost(withTags)),
    hook: stripNullBytes(opts.hook.trim()),
    hashtags,
  };
}
