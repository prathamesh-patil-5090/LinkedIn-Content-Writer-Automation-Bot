import type { StoryBucket } from '@ldp/shared';

/**
 * Topic authority: LinkedIn learns who to show a profile to from consistent
 * niche posting, so auto-picked stories come from two overlapping pillars and
 * nothing else. Edit the keyword lists below to move the niche.
 */
export type TopicPillar = 'ai-engineering' | 'ts-fullstack';

export const TOPIC_PILLARS: Record<
  TopicPillar,
  { label: string; bucket: StoryBucket; scope: string }
> = {
  'ai-engineering': {
    label: 'AI Engineering / LLM Infrastructure',
    bucket: 'ai-devtools',
    scope:
      'LLM apps, agents, RAG, evals, inference, model serving, AI coding tools, LLM SDKs',
  },
  'ts-fullstack': {
    label: 'TypeScript / Full-Stack Systems',
    bucket: 'js-lib',
    scope:
      'TypeScript and JavaScript runtimes, frameworks, API and data-layer design, build tooling, architecture patterns',
  },
};

const KEYWORDS: Record<TopicPillar, RegExp[]> = {
  'ai-engineering': [
    /\bllms?\b/,
    /\blarge language models?\b/,
    /\brag\b/,
    /\bretrieval[- ]augmented\b/,
    /\bembeddings?\b/,
    /\bvector (?:db|database|store|search|index)\b/,
    /\b(?:ai|llm|coding|autonomous) agents?\b/,
    /\bagentic\b/,
    /\bmcp\b/,
    /\bmodel context protocol\b/,
    /\bprompt (?:engineering|caching|injection)\b/,
    /\bcontext window\b/,
    /\b(?:model|llm) (?:inference|serving|routing|evals?)\b/,
    /\bfine[- ]?tun(?:e|ed|ing)\b/,
    /\b(?:tool|function) calling\b/,
    /\bstructured outputs?\b/,
    /\bopenai\b/,
    /\banthropic\b/,
    /\bclaude\b/,
    /\bchatgpt\b/,
    /\bgpt-?\d/,
    /\bgemini\b/,
    /\bllama\b/,
    /\bollama\b/,
    /\bmistral\b/,
    /\blangchain\b/,
    /\blanggraph\b/,
    /\bllamaindex\b/,
    /\bai sdk\b/,
    /\bcopilot\b/,
    /\bai coding\b/,
    /\bai engineering\b/,
    /\bgenerative ai\b/,
    /\bgenai\b/,
    /\bguardrails?\b/,
    /\bhugging ?face\b/,
  ],
  'ts-fullstack': [
    /\btypescript\b/,
    /\bjavascript\b/,
    /\bnode\.?js\b/,
    /\bdeno\b/,
    /\bbun\b/,
    /\breact\b/,
    /\bnext\.?js\b/,
    /\bvue\b/,
    /\bsvelte(?:kit)?\b/,
    /\bnpm\b/,
    /\bpnpm\b/,
    /\bvite(?:st)?\b/,
    /\btsconfig\b/,
    /\bnest\.?js\b/,
    /\bexpress\.?js\b/,
    /\bfastify\b/,
    /\bhono\b/,
    /\btrpc\b/,
    /\bgraphql\b/,
    /\bprisma\b/,
    /\bdrizzle\b/,
    /\bpostgres(?:ql)?\b/,
    /\bredis\b/,
    /\bzod\b/,
    /\bmonorepo\b/,
    /\bturborepo\b/,
    /\bserver (?:components?|actions?)\b/,
    /\bedge (?:runtime|functions?)\b/,
    /\bcloudflare workers?\b/,
    /\bserverless\b/,
    /\bwebsockets?\b/,
    /\bfull[- ]?stack\b/,
    /\bstate machines?\b/,
    /\bcommonjs\b/,
    /\bes modules?\b/,
    /\bbundlers?\b/,
    /\bwebpack\b/,
    /\bturbopack\b/,
  ],
};

/** Security news is its own niche; mixing it in dilutes both pillars. */
const OFF_PILLAR = [
  /\bcve(?:-\d|\b)/,
  /\bvulnerabilit(?:y|ies)\b/,
  /\bexploit(?:s|ed|ing|ation)?\b/,
  /\brce\b/,
  /\b(?:zero|0)-day\b/,
  /\bmalware\b/,
  /\bransomware\b/,
  /\bbackdoor(?:s|ed)?\b/,
  /\bsupply[- ]chain (?:attack|compromise)s?\b/,
  /\bdata breach(?:es)?\b/,
];

function hits(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length;
}

/**
 * Which pillar a story belongs to, or null when it is off-niche.
 * A story qualifies when a pillar keyword is in its title, or when two
 * distinct keywords appear across title and summary. A passing mention in the
 * summary (a CSS tip that says "no JavaScript needed") does not qualify.
 */
export function topicPillar(
  title: string,
  summary = '',
): TopicPillar | null {
  const t = ` ${title.toLowerCase()} `;
  const all = `${t}${summary.toLowerCase()} `;
  if (hits(all, OFF_PILLAR)) return null;

  let best: TopicPillar | null = null;
  let bestScore = 0;
  for (const pillar of Object.keys(KEYWORDS) as TopicPillar[]) {
    const inTitle = hits(t, KEYWORDS[pillar]);
    const anywhere = hits(all, KEYWORDS[pillar]);
    if (!inTitle && anywhere < 2) continue;
    const score = inTitle * 2 + anywhere;
    if (score > bestScore) {
      best = pillar;
      bestScore = score;
    }
  }
  return best;
}

/** Pillar description for the research / rank / scorer prompts. */
export function topicPillarsPrompt(): string {
  return (Object.keys(TOPIC_PILLARS) as TopicPillar[])
    .map((p, i) => {
      const { label, scope, bucket } = TOPIC_PILLARS[p];
      return `${i + 1}. ${label}: ${scope} (angle must be exactly "${bucket}")`;
    })
    .join('\n');
}
