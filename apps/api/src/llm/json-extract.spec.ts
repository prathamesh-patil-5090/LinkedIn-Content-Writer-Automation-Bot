import { extractJson } from './json-extract';

describe('extractJson', () => {
  it('parses a plain object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips fences and think tags', () => {
    const raw = `<think>nope</think>\n\`\`\`json\n{"winner":{"title":"x"}}\n\`\`\``;
    expect(extractJson(raw)).toEqual({ winner: { title: 'x' } });
  });

  it('pulls the object out of prose', () => {
    expect(extractJson('Here you go:\n{"ok":true}\nThanks')).toEqual({ ok: true });
  });
});
