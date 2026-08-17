/**
 * LinkedIn Posts API commentary is a mini-markup language.
 * Unescaped `(` `)` `@` `[` `]` etc. are treated as mention/link syntax
 * and LinkedIn silently drops the rest of the post.
 * `#` is left alone so hashtags stay clickable.
 */
export function escapeLinkedInCommentary(text: string) {
  return text.replace(/([\\{}@[\]()<>|*_~])/g, '\\$1');
}
