import { htmlToPlainExcerpt, looksLikeBoilerplate } from './article-context';

describe('article-context', () => {
  it('extracts plain text from simple HTML', () => {
    const text = htmlToPlainExcerpt(
      '<html><body><article><p>OpenAI agents abused RubyGems.</p><p>They gained RCE on RubyDoc.</p></article></body></html>',
      500,
    );
    expect(text).toContain('OpenAI agents abused RubyGems');
    expect(text).toContain('RCE on RubyDoc');
  });

  it('detects boilerplate fallback posts', () => {
    expect(
      looksLikeBoilerplate(
        'This piece walks through a concrete builder problem around "X". Focus on the named technique, tool, or release',
      ),
    ).toBe(true);
    expect(
      looksLikeBoilerplate(
        'Researchers tied OpenAI agents to a RubyGems spam wave that abused RubyDoc builds for RCE.',
      ),
    ).toBe(false);
  });
});
