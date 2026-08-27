/**
 * LinkedIn-safe Unicode text styles (same approach as
 * https://typegrow.com/tools/linkedin-text-formatter).
 *
 * LinkedIn has no rich text — these Mathematical Alphanumeric Symbols
 * look bold/italic when pasted into a post.
 */

export type LinkedInTextStyle =
  | 'Normal'
  | 'Bold'
  | 'Bold Sans'
  | 'Italic'
  | 'Italic Sans'
  | 'Bold Italic'
  | 'Bold Italic Sans'
  | 'Sans'
  | 'Underline'
  | 'Strikethrough'
  | 'Bold Underline'
  | 'Bold Strikethrough'
  | 'Script'
  | 'Doublestruck'
  | 'Fullwidth'
  | 'Uppercase'
  | 'Lowercase'
  | 'Numbered List'
  | 'Bullet Points'
  | 'Checklist'
  | 'Ascending List'
  | 'Descending List';

/** Styles shown as quick chips (matches Typegrow formatter grid). */
export const LINKEDIN_STYLE_CHIPS: LinkedInTextStyle[] = [
  'Normal',
  'Bold',
  'Bold Sans',
  'Italic',
  'Italic Sans',
  'Bold Italic',
  'Bold Italic Sans',
  'Sans',
  'Underline',
  'Strikethrough',
  'Bold Underline',
  'Bold Strikethrough',
  'Script',
  'Doublestruck',
  'Fullwidth',
  'Uppercase',
  'Lowercase',
  'Numbered List',
  'Bullet Points',
  'Checklist',
  'Ascending List',
  'Descending List',
];

type VariantKey =
  | 'm'
  | 'b'
  | 'i'
  | 'bi'
  | 'c'
  | 'bc'
  | 'g'
  | 'd'
  | 'bg'
  | 's'
  | 'bs'
  | 'is'
  | 'bis'
  | 'o'
  | 'on'
  | 'p'
  | 'q'
  | 'qn'
  | 'w';

/** [lettersStart, digitsStart] — digit offset 48 means leave digits alone. */
const VARIANT_OFFSETS: Record<VariantKey, [number, number]> = {
  m: [120432, 120822],
  b: [119808, 120782],
  i: [119860, 48],
  bi: [119912, 48],
  c: [119964, 48],
  bc: [120016, 48],
  g: [120068, 48],
  d: [120120, 120792],
  bg: [120172, 48],
  s: [120224, 120802],
  bs: [120276, 120812],
  is: [120328, 48],
  bis: [120380, 48],
  o: [9398, 9312],
  on: [127312, 9312],
  p: [9372, 9332],
  q: [127280, 48],
  qn: [127344, 48],
  w: [65313, 65296],
};

const STYLE_TO_VARIANT: Partial<Record<LinkedInTextStyle, VariantKey>> = {
  Bold: 'b',
  Italic: 'i',
  'Bold Italic': 'bi',
  Script: 'bc',
  Doublestruck: 'd',
  Sans: 's',
  'Bold Sans': 'bs',
  'Italic Sans': 'is',
  'Bold Italic Sans': 'bis',
  Fullwidth: 'w',
};

const SPECIAL: Partial<Record<VariantKey, Record<string, number>>> = {
  m: { ' ': 8192, '-': 8211 },
  i: { h: 8462 },
  g: { C: 8493, H: 8460, I: 8465, R: 8476, Z: 8488 },
  d: { C: 8450, H: 8461, N: 8469, P: 8473, Q: 8474, R: 8477, Z: 8484 },
  o: {
    '0': 9450,
    '1': 9312,
    '2': 9313,
    '3': 9314,
    '4': 9315,
    '5': 9316,
    '6': 9317,
    '7': 9318,
    '8': 9319,
    '9': 9320,
  },
};

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const UNDERLINE_COMBINING = '\u0332';
const STRIKE_COMBINING = '\u0336';

function toUnicodeVariant(
  text: string,
  variant: VariantKey,
  flags?: { underline?: boolean; strike?: boolean },
): string {
  const offsets = VARIANT_OFFSETS[variant];
  const special = { ...(SPECIAL[variant] || {}) };

  // parenthesis / fullwidth / circled lowercase maps
  if (['p', 'w', 'on', 'q', 'qn'].includes(variant)) {
    for (let t = 97; t <= 122; t++) {
      special[String.fromCharCode(t)] = offsets[0] + (t - 97);
    }
  }

  let out = '';
  for (const ch of text) {
    let c = ch;
    if (special[c] != null) {
      c = String.fromCodePoint(special[c]);
    } else {
      const alphaIdx = ALPHA.indexOf(c);
      if (alphaIdx > -1) {
        c = String.fromCodePoint(alphaIdx + offsets[0]);
      } else {
        const digitIdx = DIGITS.indexOf(c);
        if (digitIdx > -1 && offsets[1] !== 48) {
          c = String.fromCodePoint(digitIdx + offsets[1]);
        }
      }
    }
    out += c;
    if (flags?.underline) out += UNDERLINE_COMBINING;
    if (flags?.strike) out += STRIKE_COMBINING;
  }
  return out;
}

/** Strip Mathematical Alphanumeric / combining marks back toward plain text. */
export function fromUnicodeVariant(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === UNDERLINE_COMBINING || ch === STRIKE_COMBINING) continue;
    // Combining marks
    if (cp >= 0x0300 && cp <= 0x036f) continue;

    const plain = mathAlphaToAscii(cp);
    if (plain != null) {
      out += plain;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Map Mathematical Alphanumeric Symbols (and a few letterlike) → ASCII. */
function mathAlphaToAscii(cp: number): string | null {
  // Bold A–Z / a–z / 0–9
  if (cp >= 0x1d400 && cp <= 0x1d419) return String.fromCharCode(65 + (cp - 0x1d400));
  if (cp >= 0x1d41a && cp <= 0x1d433) return String.fromCharCode(97 + (cp - 0x1d41a));
  if (cp >= 0x1d7ce && cp <= 0x1d7d7) return String.fromCharCode(48 + (cp - 0x1d7ce));
  // Italic
  if (cp >= 0x1d434 && cp <= 0x1d44d) return String.fromCharCode(65 + (cp - 0x1d434));
  if (cp >= 0x1d44e && cp <= 0x1d467) return String.fromCharCode(97 + (cp - 0x1d44e));
  if (cp === 0x210e) return 'h'; // italic h
  // Bold italic
  if (cp >= 0x1d468 && cp <= 0x1d481) return String.fromCharCode(65 + (cp - 0x1d468));
  if (cp >= 0x1d482 && cp <= 0x1d49b) return String.fromCharCode(97 + (cp - 0x1d482));
  // Sans-serif
  if (cp >= 0x1d5a0 && cp <= 0x1d5b9) return String.fromCharCode(65 + (cp - 0x1d5a0));
  if (cp >= 0x1d5ba && cp <= 0x1d5d3) return String.fromCharCode(97 + (cp - 0x1d5ba));
  if (cp >= 0x1d7e2 && cp <= 0x1d7eb) return String.fromCharCode(48 + (cp - 0x1d7e2));
  // Sans-serif bold
  if (cp >= 0x1d5d4 && cp <= 0x1d5ed) return String.fromCharCode(65 + (cp - 0x1d5d4));
  if (cp >= 0x1d5ee && cp <= 0x1d607) return String.fromCharCode(97 + (cp - 0x1d5ee));
  if (cp >= 0x1d7ec && cp <= 0x1d7f5) return String.fromCharCode(48 + (cp - 0x1d7ec));
  // Sans-serif italic
  if (cp >= 0x1d608 && cp <= 0x1d621) return String.fromCharCode(65 + (cp - 0x1d608));
  if (cp >= 0x1d622 && cp <= 0x1d63b) return String.fromCharCode(97 + (cp - 0x1d622));
  // Sans-serif bold italic
  if (cp >= 0x1d63c && cp <= 0x1d655) return String.fromCharCode(65 + (cp - 0x1d63c));
  if (cp >= 0x1d656 && cp <= 0x1d66f) return String.fromCharCode(97 + (cp - 0x1d656));
  // Fullwidth
  if (cp >= 0xff21 && cp <= 0xff3a) return String.fromCharCode(65 + (cp - 0xff21));
  if (cp >= 0xff41 && cp <= 0xff5a) return String.fromCharCode(97 + (cp - 0xff41));
  if (cp >= 0xff10 && cp <= 0xff19) return String.fromCharCode(48 + (cp - 0xff10));
  return null;
}

function listType(
  text: string,
): 'Numbered List' | 'Bullet Points' | 'Checklist' | null {
  const first = text.split('\n')[0] || '';
  if (first.includes('•')) return 'Bullet Points';
  if (/\d+\./.test(first)) return 'Numbered List';
  if (first.includes('[ ]')) return 'Checklist';
  return null;
}

function removeListFormatting(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (/^(\u00A0\u00A0)?•\s/.test(line)) {
        return line.replace(/^(\u00A0\u00A0)?•\s/, '');
      }
      if (/^(\u00A0\u00A0)?\d+\.\s/.test(line)) {
        return line.replace(/^(\u00A0\u00A0)?\d+\.\s/, '');
      }
      if (/^(\u00A0\u00A0)?\[ \]\s/.test(line)) {
        return line.replace(/^(\u00A0\u00A0)?\[ \]\s/, '');
      }
      return line;
    })
    .join('\n');
}

function handleListFormatting(
  text: string,
  style: 'Numbered List' | 'Bullet Points' | 'Checklist',
): string {
  if (listType(text) === style) return removeListFormatting(text);
  const lines = removeListFormatting(text).split('\n');
  switch (style) {
    case 'Numbered List': {
      let n = 1;
      return lines
        .map((line) =>
          line.trim() ? `\u00A0\u00A0${n++}. ${line}` : line,
        )
        .join('\n');
    }
    case 'Bullet Points':
      return lines
        .map((line) => (line.trim() ? `\u00A0\u00A0• ${line}` : line))
        .join('\n');
    case 'Checklist':
      return lines
        .map((line) => (line.trim() ? `\u00A0\u00A0[ ] ${line}` : line))
        .join('\n');
  }
}

export function formatLinkedInText(
  style: LinkedInTextStyle,
  text: string,
): string {
  if (!text) return '';
  const plain = fromUnicodeVariant(text);

  switch (style) {
    case 'Normal':
      return plain;
    case 'Uppercase':
      return plain.toUpperCase();
    case 'Lowercase':
      return plain.toLowerCase();
    case 'Ascending List':
      return plain
        .split('\n')
        .sort((a, b) => a.length - b.length)
        .join('\n');
    case 'Descending List':
      return plain
        .split('\n')
        .sort((a, b) => b.length - a.length)
        .join('\n');
    case 'Numbered List':
    case 'Bullet Points':
    case 'Checklist':
      return handleListFormatting(plain, style);
    case 'Underline':
      return plain
        .split('')
        .map((ch) => (ch === '\n' ? ch : ch + UNDERLINE_COMBINING))
        .join('');
    case 'Strikethrough':
      return plain
        .split('')
        .map((ch) => (ch === '\n' ? ch : ch + STRIKE_COMBINING))
        .join('');
    case 'Bold Underline':
      return toUnicodeVariant(plain, 'b', { underline: true });
    case 'Bold Strikethrough':
      return toUnicodeVariant(plain, 'b', { strike: true });
    default: {
      const variant = STYLE_TO_VARIANT[style];
      if (!variant) return plain;
      return toUnicodeVariant(plain, variant);
    }
  }
}

/** Apply style to a selection (or whole string). Strips prior unicode first. */
export function applyLinkedInStyleToRange(
  full: string,
  start: number,
  end: number,
  style: LinkedInTextStyle,
): { text: string; start: number; end: number } {
  if (start === end) {
    const next = formatLinkedInText(style, full);
    return { text: next, start: 0, end: next.length };
  }
  const selected = full.slice(start, end);
  const formatted = formatLinkedInText(style, selected);
  const text = full.slice(0, start) + formatted + full.slice(end);
  return { text, start, end: start + formatted.length };
}

const HAS_MATH_ALPHA = /[\u{1D400}-\u{1D7FF}]/u;

/**
 * Convert Markdown-style emphasis to LinkedIn Unicode (Typegrow-style).
 * `**bold**` → Bold Sans, `*italic*` / `_italic_` → Italic Sans.
 */
export function applyLinkedInMarkdown(text: string): string {
  if (!text) return '';
  let out = text;
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) =>
    formatLinkedInText('Bold Sans', inner),
  );
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_m, before: string, inner: string) =>
    `${before}${formatLinkedInText('Italic Sans', inner)}`,
  );
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_m, before: string, inner: string) =>
    `${before}${formatLinkedInText('Italic Sans', inner)}`,
  );
  return out;
}

/**
 * Ensure a LinkedIn post has visible Unicode emphasis.
 * Converts ** / * markers; if still plain, Bold Sans the hook line.
 */
export function polishLinkedInPostText(postText: string, hook?: string): string {
  let text = applyLinkedInMarkdown(postText.trim());
  if (HAS_MATH_ALPHA.test(text)) return text;

  const lines = text.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx < 0) return text;

  const plainHook = (hook || lines[firstIdx]).trim();
  const firstPlain = fromUnicodeVariant(lines[firstIdx]).trim();
  // Prefer bolding the hook when it matches the first line; else bold first line.
  if (
    firstPlain === plainHook ||
    firstPlain.startsWith(plainHook) ||
    plainHook.startsWith(firstPlain.slice(0, Math.min(40, firstPlain.length)))
  ) {
    lines[firstIdx] = formatLinkedInText('Bold Sans', firstPlain);
  } else {
    lines[firstIdx] = formatLinkedInText('Bold Sans', firstPlain);
  }
  return lines.join('\n');
}
