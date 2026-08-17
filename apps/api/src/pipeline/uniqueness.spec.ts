import {
  isSameStory,
  normalizeUrl,
  similarText,
  significantTokens,
  jaccard,
} from './uniqueness';

describe('story uniqueness', () => {
  it('treats the same URL as the same story', () => {
    expect(
      isSameStory(
        'Alpha',
        'https://www.example.com/post/?utm_source=hn',
        'Beta',
        'https://example.com/post',
      ),
    ).toBe(true);
  });

  it('treats near-identical titles as the same story', () => {
    expect(
      isSameStory(
        'Open source maintainer pulls the plug on npm packages colors and faker',
        'https://a.dev/1',
        'Open-source maintainer pulls the plug on npm packages colors and faker, now what?',
        'https://news.ycombinator.com/item?id=1',
      ),
    ).toBe(true);
  });

  it('does not collapse unrelated titles', () => {
    expect(
      isSameStory(
        'Critical RCE in React Server Components',
        'https://a.dev/rce',
        'Snyk finds prompt injection in agent skills',
        'https://b.dev/snyk',
      ),
    ).toBe(false);
  });
});

describe('post uniqueness', () => {
  it('flags the same post body', () => {
    const text =
      'Over a third of AI agent skills are vulnerable to prompt injection. Patch your stack.';
    expect(similarText(text, text, 0.5)).toBe(true);
  });

  it('keeps distinct posts', () => {
    expect(
      similarText(
        'Pin your React version today after the RSC RCE. Upgrade to the patched release before you ship.',
        'Snyk scanned agent skill packs and found prompt injection in more than a third of them.',
        0.5,
      ),
    ).toBe(false);
  });
});

describe('url normalize', () => {
  it('drops www, query, and trailing slash', () => {
    expect(normalizeUrl('https://www.Foo.com/bar/?x=1')).toBe('foo.com/bar');
  });
});

describe('jaccard', () => {
  it('is 1 for identical token sets', () => {
    const t = significantTokens('react server components rce');
    expect(jaccard(t, t)).toBe(1);
  });
});
