import {
  applyMarkdownFormat,
  foldStyledLetters,
  formatLinkedInPost,
  toBoldSans,
} from './format';
import { mergeHashtags } from './hashtags';
import { polishDraft } from './polish';

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

  it('appends a clickable primary source URL', () => {
    const out = polishDraft({
      postText: '**Full hook title here.**\n\nBody with a complete lesson.',
      hook: 'Full hook title here.',
      hashtags: ['#BuildInPublic'],
      sourceLink: 'https://dev.to/example/article',
      sourceTitle: 'Example article',
    });
    expect(out.postText).toContain('https://dev.to/example/article');
    expect(out.postText).toMatch(/Primary source/i);
  });
});
