import { existsSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';

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

export function kickerFrom(text: string) {
  const blob = text.toLowerCase();
  if (/cve|rce|vulnerab|exploit|patch|breach|security/.test(blob)) {
    return 'SECURITY ALERT';
  }
  if (/\bai\b|llm|gpt|model|openai|claude/.test(blob)) return 'AI BRIEFING';
  if (/react|next\.?js|node|typescript|javascript/.test(blob)) {
    return 'ENGINEERING';
  }
  return 'TECH BRIEFING';
}

function fontDir() {
  const candidates = [
    join(process.cwd(), 'assets/fonts'),
    join(__dirname, '../../assets/fonts'),
    join(__dirname, '../assets/fonts'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'Inter-Bold.ttf')));
}

export function makeQuoteCardPng(opts: {
  hook: string;
  source?: string;
  kicker?: string;
}) {
  const fonts = fontDir();
  if (!fonts) throw new Error('Quote card fonts missing');

  const hook = (opts.hook || 'Today in tech').trim();
  const kicker = (opts.kicker || kickerFrom(`${hook} ${opts.source || ''}`))
    .slice(0, 28)
    .toUpperCase();
  const lines = wrap(hook, 22, 4);
  const source = clipAtWord(
    (opts.source || '').replace(/^https?:\/\//, ''),
    48,
  );

  const lineH = 78;
  const hookStart = 300;
  const ruleY = hookStart + lines.length * lineH + 28;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#08201C"/>
      <stop offset="45%" stop-color="#0B1220"/>
      <stop offset="100%" stop-color="#0F172A"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect x="0" y="0" width="16" height="1024" fill="#2DD4BF"/>
  <rect x="0" y="0" width="1024" height="8" fill="#2DD4BF"/>
  <text x="88" y="220" fill="#5EEAD4" font-family="Inter" font-size="22" font-weight="600" letter-spacing="6">${esc(kicker)}</text>
  ${lines
    .map(
      (line, i) =>
        `<text x="88" y="${hookStart + i * lineH}" fill="#F8FAFC" font-family="Inter" font-size="64" font-weight="700">${esc(line)}</text>`,
    )
    .join('\n  ')}
  <rect x="88" y="${ruleY}" width="72" height="6" rx="3" fill="#2DD4BF"/>
  ${
    source
      ? `<text x="88" y="920" fill="#94A3B8" font-family="Inter" font-size="22" font-weight="600">${esc(source)}</text>`
      : ''
  }
  <text x="88" y="960" fill="#64748B" font-family="Inter" font-size="18" font-weight="600">LinkedIn daily brief</text>
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
