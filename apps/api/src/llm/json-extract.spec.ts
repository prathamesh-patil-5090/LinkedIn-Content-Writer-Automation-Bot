import { extractJson, stripReasoningNoise } from './json-extract';

describe('extractJson', () => {
  it('parses a plain object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips fences and think tags', () => {
    const raw = `<think>nope</think>\n\`\`\`json\n{"winner":{"title":"x"}}\n\`\`\``;
    expect(extractJson(raw)).toEqual({ winner: { title: 'x' } });
  });

  it('strips unclosed think tags before JSON', () => {
    const raw = `<think>
He is ranking stories carefully...
{"top_stories":[{"title":"x","link":"https://example.com","why_it_matters":"y","trend_score":8,"angle":"js-lib"}]}`;
    expect(extractJson(raw)).toEqual({
      top_stories: [
        {
          title: 'x',
          link: 'https://example.com',
          why_it_matters: 'y',
          trend_score: 8,
          angle: 'js-lib',
        },
      ],
    });
  });

  it('pulls the object out of prose', () => {
    expect(extractJson('Here you go:\n{"ok":true}\nThanks')).toEqual({ ok: true });
  });
});

describe('stripReasoningNoise', () => {
  it('drops unclosed think preamble', () => {
    expect(stripReasoningNoise('<think>abc{"a":1}')).toBe('{"a":1}');
  });
});
