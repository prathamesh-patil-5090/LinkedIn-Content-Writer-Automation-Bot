import {
  applyMarkdownFormat,
  foldStyledLetters,
  formatLinkedInPost,
  toBoldSans,
} from './format';
import { mergeHashtags } from './hashtags';
import { findLinks, polishDraft, sourceCredit } from './polish';

describe('linkedin unicode format', () => {
  it('maps bold sans like Typegrow', () => {
    expect(toBoldSans('React')).toBe('𝗥𝗲𝗮𝗰𝘁');
    expect(toBoldSans('Node 22')).toBe('𝗡𝗼𝗱𝗲 𝟮𝟮');
  });

  it('converts markdown and leaves hashtags / urls alone', () => {
    const out = applyMarkdownFormat(
      'Try **React 19** and *maybe* ship it https://react.dev #react',
    );
    expect(out).toContain('𝗥𝗲𝗮𝗰𝘁 𝟭𝟵');
    expect(out).toContain('https://react.dev');
    expect(out).toContain('#react');
    expect(foldStyledLetters(out).toLowerCase()).toContain('react 19');
  });

  it('turns backticks into bold and strips dash pauses', () => {
    const out = applyMarkdownFormat(
      'Pin `1.3.x` — then open vitest.config.ts - and breathe.',
    );
    expect(out).not.toContain('`');
    expect(out).not.toContain('—');
    expect(out).not.toMatch(/\s-\s/);
    expect(foldStyledLetters(out).toLowerCase()).toContain('1.3.x');
  });

  it('removes a duplicated opening title', () => {
    const { dedupeLeadingTitle, formatLinkedInPost, foldForCompare } =
      require('./format') as typeof import('./format');
    const raw =
      'Vercel & Netlify Are Great. But What About Deploying Background Workers?\n\nVercel & Netlify Are Great. But What About Deploying Background Workers?\n\nI tried Railway for a worker.';
    const deduped = dedupeLeadingTitle(raw);
    expect(deduped.split('\n').filter((l: string) => l.trim()).length).toBe(2);
    const out = formatLinkedInPost(raw + '\n\n#WebDev');
    const lines = out.split('\n').filter((l: string) => l.trim() && !l.startsWith('#'));
    expect(foldForCompare(lines[0])).toContain('vercel');
    expect(foldForCompare(lines[1])).not.toBe(foldForCompare(lines[0]));
  });

  it('does not emit null bytes when a URL is on the hook line', () => {
    const out = formatLinkedInPost('See https://react.dev now.\n\n#react');
    expect(out.includes('\u0000')).toBe(false);
    expect(out).toContain('https://react.dev');
  });

  it('bolds the hook line and keeps hashtag footer ascii', () => {
    const out = formatLinkedInPost(
      'Node 22 landed.\n\nUpgrade already.\n\n#NodeJS #JavaScript',
    );
    expect(out.startsWith('𝗡𝗼𝗱𝗲')).toBe(true);
    expect(out).toContain('#NodeJS #JavaScript');
  });
});

describe('hashtags', () => {
  it('fills 5-8 tags from the category pool', () => {
    const tags = mergeHashtags(['#NodeJS'], 'js-lib');
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(tags.length).toBeLessThanOrEqual(8);
    expect(tags).toContain('#BuildInPublic');
    expect(tags).toContain('#NodeJS');
  });

  it('rotates away recently used topic tags', () => {
    const tags = mergeHashtags(['#NodeJS'], 'js-lib', [
      '#JavaScript',
      '#TypeScript',
      '#WebDev',
      '#OpenSource',
      '#Frontend',
    ]);
    expect(tags).toContain('#BuildInPublic');
    expect(tags).toContain('#LearnInPublic');
    expect(tags).toContain('#NodeJS');
    expect(tags).toContain('#Backend');
    expect(tags).not.toContain('#JavaScript');
    expect(tags).not.toContain('#TypeScript');
  });
});

describe('polishDraft', () => {
  it('formats and appends tags', () => {
    const out = polishDraft({
      postText: '**Ship the bump.**\n\nThen go outside.\n\n#JS',
      hook: 'Ship the bump.',
      hashtags: ['#JS'],
      category: 'js-lib',
    });
    expect(out.postText).toContain('𝗦𝗵𝗶𝗽');
    expect(out.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(out.postText).toMatch(/#BuildInPublic/);
  });

  const draft = {
    postText: [
      '**Full hook title here.**',
      'A breakdown by some_user of a cross-framework engine (https://dev.to/some_user/engine).',
      '- The core has no framework imports.\n- Each adapter stays thin.',
      'See github.com/some_user/engine for the code.',
      'Primary source (dev.to):\nhttps://dev.to/some_user/engine',
      'Which part would you extract first?',
    ].join('\n\n'),
    hook: 'Full hook title here.',
    hashtags: ['#BuildInPublic'],
    sourceLink: 'https://dev.to/some_user/engine',
    sourceTitle: 'Building a cross-framework engine',
  };

  it('publishes no links and credits the source by name instead', () => {
    const out = polishDraft(draft);
    expect(findLinks(out.postText)).toEqual([]);
    expect(out.postText).not.toMatch(/https?:|dev\.to|github\.com/i);
    expect(out.postText).not.toMatch(/Primary source/i);
    expect(out.postText).toContain(
      'Source: "Building a cross-framework engine" by some_user on DEV',
    );
    // The credit sits between the closing question and the hashtags.
    const blocks = out.postText.split('\n\n');
    expect(blocks[blocks.length - 2]).toMatch(/^Source: /);
    expect(blocks[blocks.length - 1]).toMatch(/^#/);
  });

  it('keeps bullets as separate lines', () => {
    const out = polishDraft(draft);
    const bullets = out.postText.split('\n').filter((l) => l.startsWith('• '));
    expect(bullets).toHaveLength(2);
  });

  it('gives the same post when polished again on approve', () => {
    const once = polishDraft(draft);
    const twice = polishDraft({
      ...draft,
      postText: once.postText,
      hashtags: once.hashtags,
    });
    expect(twice.postText).toBe(once.postText);
  });

  it('adds no credit without a source title', () => {
    const out = polishDraft({ ...draft, sourceLink: null, sourceTitle: null });
    expect(out.postText).not.toContain('Source:');
  });

  it('names the origin for common hosts', () => {
    expect(sourceCredit('https://github.com/vercel/ai/releases', 'AI SDK 6')).toBe(
      'Source: "AI SDK 6" in vercel/ai on GitHub',
    );
    expect(sourceCredit('https://blog.cloudflare.com/x', 'Workers')).toBe(
      'Source: "Workers" via Cloudflare',
    );
    expect(sourceCredit('not a url', 'Title only')).toBe('Source: "Title only"');
  });
});
