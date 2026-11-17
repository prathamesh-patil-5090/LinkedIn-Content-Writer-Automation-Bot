export const STORY_BUCKETS = [
  'js-lib',
  'ai-devtools',
  'security-bug',
  'dev-tool',
] as const;
export type StoryBucket = (typeof STORY_BUCKETS)[number];

export const CONTENT_TYPES = [
  ...STORY_BUCKETS,
  'howto',
  'architecture',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  'js-lib': 'JS / libs',
  'ai-devtools': 'AI tools',
  'security-bug': 'Security',
  'dev-tool': 'Dev tool',
  howto: 'How-to',
  architecture: 'Architecture',
};

export function normalizeBucket(angle?: string): StoryBucket {
  const a = (angle || '').toLowerCase();
  if (
    a.includes('security') ||
    a.includes('cve') ||
    a.includes('bug') ||
    a.includes('exploit') ||
    a.includes('rce')
  ) {
    return 'security-bug';
  }
  if (
    a.includes('ai') ||
    a.includes('llm') ||
    a.includes('agent') ||
    a.includes('copilot') ||
    a.includes('rag')
  ) {
    return 'ai-devtools';
  }
  if (
    a.includes('js') ||
    a.includes('ts') ||
    a.includes('lib') ||
    a.includes('npm') ||
    a.includes('react') ||
    a.includes('node')
  ) {
    return 'js-lib';
  }
  return 'dev-tool';
}

/**
 * Topic authority: auto-picked LinkedIn stories come from two pillars only.
 * ai-devtools = AI engineering / LLM infrastructure,
 * js-lib = TypeScript / full-stack systems.
 */
export const AUTHORITY_BUCKETS: StoryBucket[] = ['ai-devtools', 'js-lib'];

/** Story buckets the ranker may pick for this content type. */
export function storyBucketsFor(type: ContentType): StoryBucket[] {
  if (type === 'security-bug') return ['security-bug'];
  if (type === 'js-lib') return ['js-lib'];
  if (type === 'ai-devtools') return ['ai-devtools'];
  return [...AUTHORITY_BUCKETS];
}

export function fallbackBuckets(_type: ContentType): StoryBucket[] {
  return [...AUTHORITY_BUCKETS];
}
