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
});
