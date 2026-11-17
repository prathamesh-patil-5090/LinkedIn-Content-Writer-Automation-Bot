import { topicPillar, topicPillarsPrompt } from './topic-authority';

describe('topicPillar', () => {
  it('maps stories onto the two authority pillars', () => {
    expect(
      topicPillar('Building a cross-framework UI engine in pure TypeScript'),
    ).toBe('ts-fullstack');
    expect(topicPillar('Node.js 24 ships a built-in test runner')).toBe(
      'ts-fullstack',
    );
    expect(topicPillar('What prompt caching does to LLM inference cost')).toBe(
      'ai-engineering',
    );
    expect(topicPillar('Evals for RAG pipelines, a field guide')).toBe(
      'ai-engineering',
    );
  });

  it('picks the pillar the title is about when both appear', () => {
    expect(
      topicPillar(
        'A TypeScript SDK for LLM tool calling',
        'Structured outputs and function calling for agents.',
      ),
    ).toBe('ai-engineering');
  });

  it('rejects security news even when it mentions the stack', () => {
    expect(
      topicPillar('Critical RCE in a popular npm package (CVE-2026-1234)'),
    ).toBeNull();
    expect(
      topicPillar('AI agents found exploiting a package registry'),
    ).toBeNull();
  });

  it('rejects off-niche stories', () => {
    expect(topicPillar('Rust 2.0 released')).toBeNull();
    expect(topicPillar('Show HN: I made a recipe app')).toBeNull();
    expect(topicPillar('Why senior engineers burn out')).toBeNull();
  });

  it('needs more than a passing mention in the summary', () => {
    expect(
      topicPillar('Pure CSS scroll animations', 'No JavaScript needed.'),
    ).toBeNull();
    expect(
      topicPillar(
        'A faster way to ship internal tools',
        'Uses Next.js server actions with Prisma and Postgres.',
      ),
    ).toBe('ts-fullstack');
  });
});

describe('topicPillarsPrompt', () => {
  it('names both pillars and their buckets', () => {
    const prompt = topicPillarsPrompt();
    expect(prompt).toContain('AI Engineering / LLM Infrastructure');
    expect(prompt).toContain('TypeScript / Full-Stack Systems');
    expect(prompt).toContain('"ai-devtools"');
    expect(prompt).toContain('"js-lib"');
  });
});
