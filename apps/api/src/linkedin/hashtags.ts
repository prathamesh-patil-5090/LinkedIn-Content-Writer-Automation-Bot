import type { ContentType } from '@ldp/shared';
import { splitHashtagFooter } from './format';

const ALWAYS = ['#BuildInPublic', '#LearnInPublic'];

const BY_TYPE: Record<string, string[]> = {
  'js-lib': ['#JavaScript', '#TypeScript', '#NodeJS', '#WebDev', '#OpenSource'],
  'ai-devtools': ['#AI', '#LLM', '#DevTools', '#JavaScript', '#MachineLearning'],
  'security-bug': ['#CyberSecurity', '#AppSec', '#InfoSec', '#JavaScript', '#NodeJS'],
  'dev-tool': ['#DevTools', '#WebDev', '#JavaScript', '#Productivity'],
  howto: ['#CodingTips', '#JavaScript', '#WebDev', '#100DaysOfCode'],
  architecture: ['#SoftwareArchitecture', '#SystemDesign', '#Engineering', '#JavaScript'],
};

function clean(tag: string) {
  const t = tag.trim();
  if (!t) return '';
  const withHash = t.startsWith('#') ? t : `#${t}`;
  return withHash.replace(/[^#A-Za-z0-9_]/g, '');
}

export function mergeHashtags(
  existing: string[],
  category?: ContentType | string,
) {
  const pool = [
    ...existing,
    ...(BY_TYPE[category || ''] || BY_TYPE['js-lib']),
    ...ALWAYS,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pool) {
    const tag = clean(raw);
    if (!tag || tag === '#') continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

export function withHashtagFooter(post: string, tags: string[]) {
  const { body } = splitHashtagFooter(post);
  if (!tags.length) return body;
  return `${body.trimEnd()}\n\n${tags.join(' ')}`;
}
