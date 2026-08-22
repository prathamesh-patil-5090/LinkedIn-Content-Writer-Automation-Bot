import { extractJson } from './json-extract';

describe('extractJson', () => {
  it('parses a plain object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips fences and think tags', () => {
    const raw = `<think>nope</think>\n\`\`\`json\n{"winner":{"title":"x"}}\n\`\`\``;
    expect(extractJson(raw)).toEqual({ winner: { title: 'x' } });
  });

  it('strips an unclosed think dump and reads the JSON after it', () => {
    expect(
      extractJson('<think> The user wants a post\n{"ok":true}'),
    ).toEqual({ ok: true });
  });

  it('rejects think-only output', () => {
    expect(() => extractJson('<think> The user wants')).toThrow(/no JSON/i);
  });

  it('pulls the object out of prose', () => {
    expect(extractJson('Here you go:\n{"ok":true}\nThanks')).toEqual({ ok: true });
  });

  it('repairs schema-copied trend_score ranges', () => {
    expect(
      extractJson(
        '{"top_stories":[{"title":"x","link":"https://e.com","why_it_matters":"do it","trend_score":1-10,"angle":"js-lib"}]}',
      ),
    ).toMatchObject({
      top_stories: [{ trend_score: 1, angle: 'js-lib' }],
    });
  });

  it('closes a truncated object', () => {
    expect(extractJson('{"winner":{"title":"Node 22"')).toEqual({
      winner: { title: 'Node 22' },
    });
  });
});
