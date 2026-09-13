import type { ContentType } from '@ldp/shared';
import { splitHashtagFooter } from './format';

const ALWAYS = ['#BuildInPublic', '#LearnInPublic'];

const BY_TYPE: Record<string, string[]> = {
  'js-lib': [
    '#JavaScript',
    '#TypeScript',
    '#NodeJS',
    '#WebDev',
    '#OpenSource',
    '#Frontend',
    '#Backend',
    '#ReactJS',
    '#NextJS',
    '#Coding',
  ],
  'ai-devtools': [
    '#AI',
    '#LLM',
    '#DevTools',
    '#JavaScript',
    '#MachineLearning',
    '#GenerativeAI',
    '#Agents',
  ],
  'security-bug': [
    '#CyberSecurity',
    '#AppSec',
    '#InfoSec',
    '#JavaScript',
    '#NodeJS',
    '#CVE',
    '#SecureCoding',
  ],
  'dev-tool': [
    '#DevTools',
    '#WebDev',
    '#JavaScript',
    '#Productivity',
    '#DeveloperExperience',
    '#OSS',
  ],
  howto: [
    '#CodingTips',
    '#JavaScript',
    '#WebDev',
    '#100DaysOfCode',
    '#LearnToCode',
    '#Tip',
  ],
  architecture: [
    '#SoftwareArchitecture',
    '#SystemDesign',
    '#Engineering',
    '#JavaScript',
    '#Backend',
    '#Scalability',
  ],
};

function clean(tag: string) {
  const t = tag.trim();
  if (!t) return '';
  const withHash = t.startsWith('#') ? t : `#${t}`;
  return withHash.replace(/[^#A-Za-z0-9_]/g, '');
}

/**
 * Build 5–8 hashtags, preferring tags not used in recent posts.
 * Reserves #BuildInPublic + #LearnInPublic; rotates topic tags.
 */
export function mergeHashtags(
  existing: string[],
  category?: ContentType | string,
  avoidRecent: string[] = [],
) {
  const avoid = new Set(
    avoidRecent.map((t) => clean(t).toLowerCase()).filter(Boolean),
  );
  for (const brand of ALWAYS) avoid.delete(brand.toLowerCase());

  const preferred = existing.map(clean).filter(Boolean);
  const categoryPool = BY_TYPE[category || ''] || BY_TYPE['js-lib'];

  const seen = new Set<string>();
  const topic: string[] = [];
  const pushTopic = (raw: string) => {
    const tag = clean(raw);
    if (!tag || tag === '#') return;
    const key = tag.toLowerCase();
    if (ALWAYS.some((b) => b.toLowerCase() === key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    topic.push(tag);
  };

  for (const t of preferred) {
    if (avoid.has(t.toLowerCase())) continue;
    pushTopic(t);
    if (topic.length >= 6) break;
  }
  for (const t of categoryPool) {
    if (topic.length >= 6) break;
    if (avoid.has(t.toLowerCase())) continue;
    pushTopic(t);
  }
  // Prefer fewer fresh tags over recycling the last posts' tags.

  const out = [...topic.slice(0, 6), ...ALWAYS];
  return out.slice(0, 8);
}

export function withHashtagFooter(post: string, tags: string[]) {
  const { body } = splitHashtagFooter(post);
  if (!tags.length) return body;
  return `${body.trimEnd()}\n\n${tags.join(' ')}`;
}
