/**
 * LinkedIn has no real bold/italic. Tools like Typegrow map letters onto
 * Unicode Mathematical Alphanumeric Symbols so the feed *looks* formatted.
 * https://typegrow.com/tools/linkedin-text-formatter
 *
 * Leave #hashtags, URLs, and @handles in ASCII so they stay clickable.
 */

type Style = 'bold' | 'italic' | 'boldItalic';

const ITALIC_H = 0x210e;

function mapChar(ch: string, style: Style): string {
  const code = ch.codePointAt(0);
  if (code == null) return ch;
  if (code >= 0x1d400 && code <= 0x1d7ff) return ch;
  if (code === ITALIC_H) return ch;

  if (code >= 0x41 && code <= 0x5a) {
    const i = code - 0x41;
    if (style === 'bold') return String.fromCodePoint(0x1d5d4 + i);
    if (style === 'italic') return String.fromCodePoint(0x1d434 + i);
    return String.fromCodePoint(0x1d63c + i);
  }
  if (code >= 0x61 && code <= 0x7a) {
    const i = code - 0x61;
    if (style === 'bold') return String.fromCodePoint(0x1d5ee + i);
    if (style === 'italic') {
      return i === 7
        ? String.fromCodePoint(ITALIC_H)
        : String.fromCodePoint(0x1d44e + i);
    }
    return String.fromCodePoint(0x1d656 + i);
  }
  if (code >= 0x30 && code <= 0x39 && style === 'bold') {
    return String.fromCodePoint(0x1d7ec + (code - 0x30));
  }
  return ch;
}

export function toBoldSans(text: string) {
  return [...text].map((ch) => mapChar(ch, 'bold')).join('');
}

export function toItalic(text: string) {
  return [...text].map((ch) => mapChar(ch, 'italic')).join('');
}

export function toBoldItalic(text: string) {
  return [...text].map((ch) => mapChar(ch, 'boldItalic')).join('');
}

const TOKEN_OPEN = '\uE000';
const TOKEN_CLOSE = '\uE001';
const TOKEN_INDEX = 0xe100;

function protectTokens(text: string) {
  const tokens: string[] = [];
  const stash = (value: string) => {
    tokens.push(value);
    return `${TOKEN_OPEN}${String.fromCodePoint(TOKEN_INDEX + tokens.length - 1)}${TOKEN_CLOSE}`;
  };
  const protectedText = text
    .replace(/https?:\/\/[^\s)]+/g, stash)
    .replace(/@[A-Za-z0-9._-]+/g, stash)
    .replace(/#[A-Za-z0-9_]+/g, stash);
  return {
    text: protectedText,
    restore: (value: string) =>
      value.replace(
        new RegExp(`${TOKEN_OPEN}([\\uE100-\\uE1FF])${TOKEN_CLOSE}`, 'g'),
        (_, mark: string) => {
          const i = (mark.codePointAt(0) || TOKEN_INDEX) - TOKEN_INDEX;
          return tokens[i] || '';
        },
      ),
  };
}

/** Postgres rejects U+0000 in text columns. */
export function stripNullBytes(value: string) {
  return value.replace(/\u0000/g, '');
}

function styleChunk(text: string, style: Style) {
  if (style === 'bold') return toBoldSans(text);
  if (style === 'italic') return toItalic(text);
  return toBoldItalic(text);
}

/** Convert Typegrow-style markdown (**bold**, *italic*) to Unicode. */
export function applyMarkdownFormat(input: string) {
  const { text, restore } = protectTokens(input);
  const formatted = text
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, inner) => styleChunk(inner, 'boldItalic'))
    .replace(/\*\*(.+?)\*\*/g, (_, inner) => styleChunk(inner, 'bold'))
    .replace(/__(.+?)__/g, (_, inner) => styleChunk(inner, 'bold'))
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, inner) =>
      styleChunk(inner, 'italic'),
    )
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_, inner) =>
      styleChunk(inner, 'italic'),
    );
  return restore(formatted);
}

const FOLD_RANGES: Array<{ start: number; A: number; a: number }> = [
  { start: 0x1d400, A: 0x41, a: 0x61 }, // bold
  { start: 0x1d434, A: 0x41, a: 0x61 }, // italic
  { start: 0x1d468, A: 0x41, a: 0x61 }, // bold italic
  { start: 0x1d5a0, A: 0x41, a: 0x61 }, // sans
  { start: 0x1d5d4, A: 0x41, a: 0x61 }, // sans bold
  { start: 0x1d608, A: 0x41, a: 0x61 }, // sans italic
  { start: 0x1d63c, A: 0x41, a: 0x61 }, // sans bold italic
];

/** Fold Typegrow/math letters back to ASCII for uniqueness / search. */
export function foldStyledLetters(text: string) {
  return [...text]
    .map((ch) => {
      const c = ch.codePointAt(0);
      if (c == null) return ch;
      if (c === ITALIC_H) return 'h';
      if (c >= 0x1d7ec && c <= 0x1d7f5) {
        return String.fromCharCode(0x30 + (c - 0x1d7ec));
      }
      if (c >= 0x1d7ce && c <= 0x1d7d7) {
        return String.fromCharCode(0x30 + (c - 0x1d7ce));
      }
      for (const range of FOLD_RANGES) {
        if (c >= range.start && c < range.start + 26) {
          return String.fromCharCode(range.A + (c - range.start));
        }
        if (c >= range.start + 26 && c < range.start + 52) {
          return String.fromCharCode(range.a + (c - range.start - 26));
        }
      }
      return ch;
    })
    .join('');
}

export function isHashtagLine(line: string) {
  const t = line.trim();
  return t.length > 0 && /^(#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)*)$/.test(t);
}

export function splitHashtagFooter(post: string) {
  const lines = post.replace(/\s+$/, '').split('\n');
  const tags: string[] = [];
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (isHashtagLine(last)) {
      tags.unshift(...last.split(/\s+/).filter((t) => t.startsWith('#')));
      lines.pop();
      continue;
    }
    break;
  }
  return { body: lines.join('\n').trimEnd(), tags };
}

function alreadyStyled(text: string) {
  return /[\u{1D400}-\u{1D7FF}]/u.test(text);
}

/**
 * Bold the hook line, honor markdown, italicize a closing question.
 * Hashtag footer stays ASCII.
 */
function styleKeepingTokens(text: string, style: Style) {
  const { text: protectedText, restore } = protectTokens(text);
  return restore(styleChunk(protectedText, style));
}

export function formatLinkedInPost(post: string) {
  const { body, tags } = splitHashtagFooter(post);
  const converted = applyMarkdownFormat(body);
  const lines = converted.split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && !alreadyStyled(lines[first])) {
    lines[first] = styleKeepingTokens(lines[first], 'bold');
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.endsWith('?') && !alreadyStyled(t) && i !== first) {
      lines[i] = styleKeepingTokens(lines[i], 'italic');
    }
    break;
  }
  const formatted = stripNullBytes(lines.join('\n').trim());
  if (!tags.length) return formatted;
  return `${formatted}\n\n${tags.join(' ')}`;
}
