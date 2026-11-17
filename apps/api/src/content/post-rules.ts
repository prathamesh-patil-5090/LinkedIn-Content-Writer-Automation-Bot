import {
  BANNED_LLM_PHRASES,
  GENERIC_PHRASES,
  fromUnicodeVariant,
} from '@ldp/shared';
import { splitHashtagFooter } from '../linkedin/format';
import { findLinks, splitSourceCredit } from '../linkedin/polish';

/**
 * One definition of what a publishable LinkedIn post looks like, shared by
 * the writer prompts and the quality gate so the two cannot drift apart.
 */
export const POST_WORDS = {
  targetMin: 150,
  targetMax: 250,
  /** Outside this range the gate sends the draft back. */
  hardMin: 110,
  hardMax: 320,
};
export const MIN_BULLETS = 2;
/** Shorter than this and the writer output is treated as a failed generation. */
export const MIN_POST_CHARS = 500;

/** Post text without hashtags and source credit, Unicode styling folded to ASCII. */
export function postBody(postText: string): string {
  const { body } = splitHashtagFooter(postText || '');
  return fold(splitSourceCredit(body).body);
}

function fold(text: string): string {
  return fromUnicodeVariant(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export function bulletCount(text: string): number {
  return text
    .split('\n')
    .filter((l) => /^\s*(?:[•\-*·▪◦]|\d+[.)])\s+\S/.test(l)).length;
}

export function endsWithQuestion(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  return /\?["')\]]*\s*$/.test(lines[lines.length - 1] || '');
}

export function bannedPhraseHits(text: string): string[] {
  const lower = fold(text).toLowerCase();
  return BANNED_LLM_PHRASES.filter((p) => lower.includes(p));
}

/** "we", "our", "us" (but not "US" or "us-east-1"), plus two words of context. */
const FIRST_PERSON_PLURAL =
  /\b(?:[Ww]e|[Oo]urs?|[Oo]urselves|us(?!-))\b(?:'\w+)?(?:[ \t]+[^\s]+){0,2}/g;

/** Singular claims of having built, run or measured something. Opinions ("I think", "I'd") pass. */
const FIRST_PERSON_SINGULAR = [
  /\bI\s+(?:(?:first|just|recently|finally|then|also|once|almost|nearly|actually)\s+)?(?:built|shipped|migrated|rewrote|refactored|deployed|launched|benchmarked|measured|implemented|tried|tested|ran|adopted|switched|replaced|spent|wrote|broke|fixed|debugged|profiled)\b(?:[ \t]+[^\s]+){0,2}/g,
  /\bI(?:'ve| have)\s+(?:been|built|shipped|seen|run|spent|tried|migrated|tested|used|worked)\b(?:[ \t]+[^\s]+){0,2}/g,
  /\b[Ww]hen I\s+(?:first|tried|built|started|joined|worked)\b(?:[ \t]+[^\s]+){0,2}/g,
  /\b[Mm]y\s+(?:team|codebase|app|product|stack|pipeline|repo|company|startup|users|customers|clients|project|production|prod|service|api|backend|frontend|monorepo|experience|last (?:job|project|company))\b/g,
];

/**
 * First-person claims in a post about someone else's work. The writer never
 * built, shipped or measured the thing it is summarising, so any "we/our"
 * story or "I built/tried" anecdote is invented. Quoted text is ignored so
 * the source can still be quoted.
 */
export function firstPersonClaims(text: string): string[] {
  const unquoted = fold(text).replace(/"[^"\n]{0,300}"/g, ' ');
  const hits = [
    ...(unquoted.match(FIRST_PERSON_PLURAL) || []),
    ...FIRST_PERSON_SINGULAR.flatMap((re) => unquoted.match(re) || []),
  ].map((h) => h.replace(/\s+/g, ' ').trim());
  return [...new Set(hits)].slice(0, 5);
}

export type PostCheck = {
  words: number;
  bullets: number;
  question: boolean;
  banned: string[];
  claims: string[];
  links: string[];
  /** Each entry sends the draft back for a rewrite. */
  violations: string[];
  /** Rewrite instructions matching the violations. */
  feedback: string[];
};

export function checkPost(opts: {
  postText: string;
  hook?: string;
  /** True when the story is the author's own project; first person is then honest. */
  ownWork?: boolean;
}): PostCheck {
  const body = postBody(opts.postText);
  const withHook = `${fold(opts.hook || '')}\n${body}`;
  const words = wordCount(body);
  const bullets = bulletCount(body);
  const question = endsWithQuestion(body);
  const banned = bannedPhraseHits(withHook);
  const claims = opts.ownWork ? [] : firstPersonClaims(withHook);
  const links = findLinks(opts.postText || '');

  const violations: string[] = [];
  const feedback: string[] = [];
  const quote = (items: string[]) => items.map((i) => `"${i}"`).join(', ');

  if (claims.length) {
    violations.push(`fabricated first-person claims: ${quote(claims)}`);
    feedback.push(
      `Remove every first-person claim (${quote(claims)}). The source is someone else's work: describe what they built in third person and credit them by name. No "we", "our" or "us". "I think" and "I'd" opinions are fine.`,
    );
  }
  if (banned.length) {
    violations.push(`banned phrases: ${quote(banned)}`);
    feedback.push(`Drop these phrases entirely: ${quote(banned)}.`);
  }
  if (links.length) {
    violations.push('external link in post body');
    feedback.push(
      'No URLs or domain names. Name the project and author so readers can search for it.',
    );
  }
  if (words < POST_WORDS.hardMin || words > POST_WORDS.hardMax) {
    violations.push(
      `length ${words} words (target ${POST_WORDS.targetMin}-${POST_WORDS.targetMax})`,
    );
    feedback.push(
      `The post is ${words} words. Write ${POST_WORDS.targetMin}-${POST_WORDS.targetMax} words.`,
    );
  }
  if (bullets < MIN_BULLETS) {
    violations.push('no bulleted breakdown');
    feedback.push(
      'Put the mechanism and trade-offs in 3-4 bullet lines, each starting with "- ".',
    );
  }
  if (!question) {
    violations.push('no closing question');
    feedback.push('End with one specific question as the last line.');
  }

  return {
    words,
    bullets,
    question,
    banned,
    claims,
    links,
    violations,
    feedback,
  };
}

/** Rules block injected into every writer prompt. */
export function postRulesPrompt(ownWork = false): string {
  const pov = ownWork
    ? `POINT OF VIEW (this is the author's own project):
- First person is fine, but only for facts present in the context.
- Do not invent metrics, users, timelines or outcomes.`
    : `POINT OF VIEW (the source is someone else's work):
- The author of this post did not build, ship, test or measure anything in the story. Never write "we", "our" or "us". Never claim an experience: no "I built", "I tried", "when I first", "my team", "in my experience".
- Write as a curator with an engineer's eye. Say what the source's author or project did, in third person, and credit them by name (author, project or publication from the context).
- First person is for opinion only: "I think", "I'd reach for this when", "my read is".
- Framing to avoid: "We slashed our component churn by 70% using a Core Vanilla Engine."
- Framing to use: "An interesting pattern is emerging in frontend architecture: stripping UI logic out of React/Vue/Svelte into a pure TypeScript state machine. A recent breakdown of cross-framework engines shows how." These two lines only illustrate the framing. Write fresh wording for this story.`;

  return `${pov}

FORMAT (scannable breakdown, not an essay):
- ${POST_WORDS.targetMin}-${POST_WORDS.targetMax} words before hashtags.
- Line 1: the hook wrapped in **bold**. An original line, not the article title, never cut off with an ellipsis.
- Then 1-2 short sentences: what it is and who made it.
- Then 3-4 bullets, each on its own line starting with "- ": how it works and the trade-offs (what you gain, what you pay, when it is the wrong call).
- Then 1-2 sentences with your read as an engineer.
- Last line: one specific question a practitioner could answer from experience.
- No URLs and no domain names anywhere in the post. Name the author or project so readers can search for it.
- No em or en dashes, no backticks. Use **bold** for 1-2 key terms.

FACTS:
- Use only what the title, summary and article excerpt support. If the excerpt is thin, say less.
- Name concrete entities from the source: tools, packages, versions, people.
- Never paste pipeline labels (Angle:, Preferred hook:) or feed metadata.

NEVER USE these phrases or close variants: ${GENERIC_PHRASES.map((p) => `"${p}"`).join(', ')}.`;
}
