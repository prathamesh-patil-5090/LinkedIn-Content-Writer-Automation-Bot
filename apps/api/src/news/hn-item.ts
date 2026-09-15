const META_LINE =
  /^(article url|comments url|points|#\s*comments|via)\s*:/i;

export function isHnMetadata(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/article url:|comments url:|points:\s*\d|#\s*comments:/i.test(t)) {
    const leftover = stripHnMetadata(t);
    return leftover.length < 40;
  }
  return false;
}

export function stripHnMetadata(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !META_LINE.test(line))
    .join(' ')
    .replace(/Article URL:\s*\S+/gi, '')
    .replace(/Comments URL:\s*\S+/gi, '')
    .replace(/Points:\s*\d+/gi, '')
    .replace(/#\s*Comments:\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function articleUrlFromHn(text: string) {
  const m = /Article URL:\s*(https?:\/\/\S+)/i.exec(text.replace(/<[^>]+>/g, ' '));
  if (!m) return null;
  return m[1].replace(/[),.;]+$/, '');
}

export function cleanStoryBlurb(title: string, raw: string, maxLen = 500) {
  const cleaned = stripHnMetadata(raw || '');
  if (cleaned && !isHnMetadata(cleaned)) {
    return clipAtWordBoundary(cleaned, maxLen);
  }
  return `${title.replace(/\s+/g, ' ').trim()}.`;
}

/** Prefer a clean cut at a word boundary; never append an ellipsis mid-title for hooks. */
export function clipAtWordBoundary(text: string, maxLen: number) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return (sp > Math.floor(maxLen * 0.5) ? cut.slice(0, sp) : cut).trim();
}
