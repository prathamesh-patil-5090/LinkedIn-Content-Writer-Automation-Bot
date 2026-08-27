import { existsSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import type { ContentType } from '@ldp/shared';
import { normalizeBucket } from '@ldp/shared';

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clipAtWord(text: string, max: number) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 16 ? cut.slice(0, sp) : cut).trim()}…`;
}

function wrap(text: string, maxChars: number, maxLines = 4) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] =
    last.length > 3 ? `${last.replace(/[,:;.]?$/, '')}…` : last;
  return kept;
}

type Layout = 'rail' | 'slash' | 'grid' | 'frame' | 'badge' | 'split';

type Theme = {
  kicker: string;
  bg0: string;
  bg1: string;
  accent: string;
  accentSoft: string;
  hook: string;
  muted: string;
  footer: string;
  layout: Layout;
};

const THEMES: Record<string, Theme> = {
  'security-bug': {
    kicker: 'SECURITY',
    bg0: '#1C0A0A',
    bg1: '#3F0D12',
    accent: '#FB7185',
    accentSoft: '#FDA4AF',
    hook: '#FFF1F2',
    muted: '#FECACA',
    footer: '#E11D48',
    layout: 'slash',
  },
  'ai-devtools': {
    kicker: 'AI TOOLS',
    bg0: '#12081F',
    bg1: '#2E1065',
    accent: '#C084FC',
    accentSoft: '#E9D5FF',
    hook: '#FAF5FF',
    muted: '#D8B4FE',
    footer: '#A78BFA',
    layout: 'grid',
  },
  'js-lib': {
    kicker: 'JAVASCRIPT',
    bg0: '#1A1405',
    bg1: '#422006',
    accent: '#FBBF24',
    accentSoft: '#FDE68A',
    hook: '#FFFBEB',
    muted: '#FCD34D',
    footer: '#D97706',
    layout: 'rail',
  },
  'dev-tool': {
    kicker: 'DEV TOOLS',
    bg0: '#06141F',
    bg1: '#0C4A6E',
    accent: '#38BDF8',
    accentSoft: '#BAE6FD',
    hook: '#F0F9FF',
    muted: '#7DD3FC',
    footer: '#0284C7',
    layout: 'frame',
  },
  howto: {
    kicker: 'HOW-TO',
    bg0: '#052E16',
    bg1: '#14532D',
    accent: '#4ADE80',
    accentSoft: '#BBF7D0',
    hook: '#F0FDF4',
    muted: '#86EFAC',
    footer: '#16A34A',
    layout: 'badge',
  },
  architecture: {
    kicker: 'ARCHITECTURE',
    bg0: '#1C1008',
    bg1: '#7C2D12',
    accent: '#FB923C',
    accentSoft: '#FED7AA',
    hook: '#FFF7ED',
    muted: '#FDBA74',
    footer: '#EA580C',
    layout: 'split',
  },
};

export function themeFor(category?: string): Theme {
  if (category && THEMES[category]) return THEMES[category];
  return THEMES[normalizeBucket(category)] || THEMES['js-lib'];
}

export function kickerFrom(text: string, category?: string) {
  if (category && THEMES[category]) return THEMES[category].kicker;
  const blob = text.toLowerCase();
  if (/cve|rce|vulnerab|exploit|patch|breach|security/.test(blob)) {
    return THEMES['security-bug'].kicker;
  }
  if (/\bai\b|llm|gpt|model|openai|claude/.test(blob)) {
    return THEMES['ai-devtools'].kicker;
  }
  if (/how to|guide|tutorial|walkthrough/.test(blob)) return THEMES.howto.kicker;
  if (/architect|design|tradeoff|system/.test(blob)) {
    return THEMES.architecture.kicker;
  }
  if (/react|next\.?js|node|typescript|javascript/.test(blob)) {
    return THEMES['js-lib'].kicker;
  }
  return THEMES['dev-tool'].kicker;
}

function fontDir() {
  const candidates = [
    join(process.cwd(), 'assets/fonts'),
    join(__dirname, '../../assets/fonts'),
    join(__dirname, '../assets/fonts'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'Inter-Bold.ttf')));
}

function hookLines(
  lines: string[],
  x: number,
  startY: number,
  lineH: number,
  fill: string,
  size = 58,
) {
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${startY + i * lineH}" fill="${fill}" font-family="Inter" font-size="${size}" font-weight="700">${esc(line)}</text>`,
    )
    .join('\n  ');
}

function layoutSvg(
  theme: Theme,
  lines: string[],
  source: string,
  kicker: string,
) {
  const t = theme;
  const src = source
    ? `<text x="88" y="918" fill="${t.muted}" font-family="Inter" font-size="20" font-weight="600">${esc(source)}</text>`
    : '';
  const foot = `<text x="88" y="958" fill="${t.footer}" font-family="Inter" font-size="16" font-weight="600">LinkedIn daily brief</text>`;

  if (t.layout === 'slash') {
    return `
  <polygon points="1024,0 1024,220 640,0" fill="${t.accent}" opacity="0.18"/>
  <polygon points="0,1024 280,1024 0,760" fill="${t.accent}" opacity="0.12"/>
  <rect x="0" y="0" width="1024" height="18" fill="${t.accent}"/>
  <rect x="72" y="168" width="220" height="40" rx="20" fill="${t.accent}"/>
  <text x="92" y="196" fill="#1C0A0A" font-family="Inter" font-size="18" font-weight="700" letter-spacing="4">${esc(kicker)}</text>
  ${hookLines(lines, 72, 320, 74, t.hook, 56)}
  <rect x="72" y="${320 + lines.length * 74}" width="96" height="8" fill="${t.accent}"/>
  ${src}${foot}`;
  }

  if (t.layout === 'grid') {
    const dots = Array.from({ length: 12 }, (_, r) =>
      Array.from({ length: 12 }, (_, c) => {
        const x = 80 + c * 76;
        const y = 80 + r * 76;
        return `<circle cx="${x}" cy="${y}" r="2.2" fill="${t.accent}" opacity="0.18"/>`;
      }).join(''),
    ).join('');
    return `
  ${dots}
  <rect x="64" y="64" width="896" height="896" fill="none" stroke="${t.accent}" stroke-opacity="0.25" stroke-width="2"/>
  <text x="88" y="200" fill="${t.accentSoft}" font-family="Inter" font-size="22" font-weight="600" letter-spacing="7">${esc(kicker)}</text>
  ${hookLines(lines, 88, 310, 76, t.hook)}
  <rect x="88" y="${310 + lines.length * 76}" width="56" height="56" fill="${t.accent}" opacity="0.85"/>
  ${src}${foot}`;
  }

  if (t.layout === 'frame') {
    return `
  <rect x="40" y="40" width="944" height="944" fill="none" stroke="${t.accent}" stroke-width="10"/>
  <rect x="64" y="64" width="896" height="896" fill="none" stroke="${t.accent}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="512" y="200" text-anchor="middle" fill="${t.accentSoft}" font-family="Inter" font-size="20" font-weight="600" letter-spacing="8">${esc(kicker)}</text>
  ${lines
    .map(
      (line, i) =>
        `<text x="512" y="${320 + i * 72}" text-anchor="middle" fill="${t.hook}" font-family="Inter" font-size="52" font-weight="700">${esc(line)}</text>`,
    )
    .join('\n  ')}
  <rect x="466" y="${320 + lines.length * 72}" width="92" height="6" rx="3" fill="${t.accent}"/>
  ${source ? `<text x="512" y="918" text-anchor="middle" fill="${t.muted}" font-family="Inter" font-size="20" font-weight="600">${esc(source)}</text>` : ''}
  <text x="512" y="958" text-anchor="middle" fill="${t.footer}" font-family="Inter" font-size="16" font-weight="600">LinkedIn daily brief</text>`;
  }

  if (t.layout === 'badge') {
    return `
  <circle cx="168" cy="210" r="78" fill="${t.accent}"/>
  <text x="168" y="224" text-anchor="middle" fill="#052E16" font-family="Inter" font-size="36" font-weight="700">01</text>
  <text x="272" y="222" fill="${t.accentSoft}" font-family="Inter" font-size="22" font-weight="600" letter-spacing="6">${esc(kicker)}</text>
  ${hookLines(lines, 88, 360, 74, t.hook, 54)}
  <rect x="88" y="${360 + lines.length * 74}" width="160" height="10" rx="5" fill="${t.accent}"/>
  ${src}${foot}`;
  }

  if (t.layout === 'split') {
    return `
  <rect x="0" y="0" width="1024" height="268" fill="${t.accent}"/>
  <text x="72" y="168" fill="#1C1008" font-family="Inter" font-size="22" font-weight="700" letter-spacing="6">${esc(kicker)}</text>
  <text x="72" y="214" fill="#7C2D12" font-family="Inter" font-size="18" font-weight="600">tradeoffs · systems · choices</text>
  ${hookLines(lines, 72, 380, 74, t.hook, 54)}
  <rect x="72" y="${380 + lines.length * 74}" width="48" height="48" fill="${t.accent}"/>
  <rect x="132" y="${380 + lines.length * 74}" width="48" height="48" fill="${t.accent}" opacity="0.45"/>
  ${src}${foot}`;
  }

  return `
  <rect x="0" y="0" width="18" height="1024" fill="${t.accent}"/>
  <rect x="0" y="0" width="1024" height="10" fill="${t.accent}"/>
  <text x="88" y="210" fill="${t.accentSoft}" font-family="Inter" font-size="22" font-weight="600" letter-spacing="6">${esc(kicker)}</text>
  ${hookLines(lines, 88, 310, 76, t.hook)}
  <rect x="88" y="${310 + lines.length * 76}" width="72" height="6" rx="3" fill="${t.accent}"/>
  ${src}${foot}`;
}

export function makeQuoteCardPng(opts: {
  hook: string;
  source?: string;
  kicker?: string;
  category?: ContentType | string;
}) {
  const fonts = fontDir();
  if (!fonts) throw new Error('Quote card fonts missing');

  const theme = themeFor(opts.category);
  const hook = (opts.hook || 'Today in tech').trim();
  const kicker = (opts.kicker || theme.kicker).slice(0, 28).toUpperCase();
  const maxChars = theme.layout === 'frame' ? 20 : 22;
  const lines = wrap(hook, maxChars, 4);
  const source = clipAtWord(
    (opts.source || '').replace(/^https?:\/\//, ''),
    48,
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.bg0}"/>
      <stop offset="100%" stop-color="${theme.bg1}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${layoutSvg(theme, lines, source, kicker)}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1024 },
    font: {
      fontFiles: [
        join(fonts, 'Inter-Bold.ttf'),
        join(fonts, 'Inter-SemiBold.ttf'),
      ],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return Buffer.from(resvg.render().asPng());
}
