import { QualityGateService } from './quality-gate.service';
import { ContentConfigService } from './content-config.service';
import { ConfigService } from '@nestjs/config';
import {
  CURATED_HOOK,
  CURATED_POST,
  FABRICATED_HOOK,
  FABRICATED_POST,
} from './post-fixtures-spec';

const config = new ContentConfigService(new ConfigService({}));

describe('QualityGateService heuristic', () => {
  const gate = new QualityGateService({} as never, config);

  it('flags generic LinkedIn fluff', () => {
    const result = gate.heuristicEvaluate({
      hook: 'Excited to announce something',
      postText:
        "Excited to announce a game changer. In today's fast-paced world, let's dive in. Thoughts?",
      sourceTitle: 'Thing',
    });
    expect(result.scores.aiGenericness).toBeGreaterThan(config.aiGenericnessMax());
    expect(result.reasons.some((r) => /generic/i.test(r))).toBe(true);
  });

  it('penalizes ungrounded percentages', () => {
    const result = gate.heuristicEvaluate({
      hook: 'Latency fell hard',
      postText:
        'Everything improved by 87% last week and users loved it across the board.',
    });
    expect(result.scores.factualGrounding).toBeLessThan(5);
  });

  it('accepts a percentage the post attributes to the source', () => {
    const result = gate.heuristicEvaluate({
      hook: 'Latency fell hard',
      postText:
        'The author reports a 40% drop in cold starts after moving to the edge runtime.',
    });
    expect(result.scores.factualGrounding).toBeGreaterThan(5);
  });

  it('scores a curated breakdown as clean', () => {
    const h = gate.heuristicEvaluate({
      hook: CURATED_HOOK,
      postText: CURATED_POST,
    });
    expect(h.violations).toEqual([]);
    expect(h.scores.aiGenericness).toBe(0);
    expect(h.scores.authenticity).toBeGreaterThan(config.authenticityThreshold());
    expect(gate.compositeQuality(h.scores)).toBeGreaterThan(
      config.qualityScoreThreshold(),
    );
  });

  it('scores first person as inauthentic unless the work is the author\u2019s own', () => {
    const curated = gate.heuristicEvaluate({
      hook: FABRICATED_HOOK,
      postText: FABRICATED_POST,
    });
    expect(curated.scores.authenticity).toBeLessThan(
      config.authenticityThreshold(),
    );
    expect(curated.violations.join(' ')).toMatch(/fabricated first-person/);

    const own = gate.heuristicEvaluate({
      hook: FABRICATED_HOOK,
      postText: FABRICATED_POST.replace(
        'The breakthrough came when',
        'It clicked when',
      ),
      ownWork: true,
    });
    expect(own.violations.join(' ')).not.toMatch(/first-person/);
    expect(own.scores.authenticity).toBeGreaterThan(7);
  });

  it('does not let harsh LLM scores zero out a solid heuristic base', () => {
    const base = gate.heuristicEvaluate({
      hook: CURATED_HOOK,
      postText: CURATED_POST,
    }).scores;
    const blended = gate.blendScores(base, {
      authenticity: 2,
      aiGenericness: 9,
      factualGrounding: 1,
      technicalAccuracy: 1,
      educationalValue: 1,
      originality: 1,
      readability: 1,
      storytelling: 1,
      relevance: 1,
      hook: 1,
      repetition: 9,
    });
    expect(blended.authenticity).toBeGreaterThanOrEqual(base.authenticity - 2);
    expect(blended.authenticity).toBeGreaterThan(4);
    expect(gate.compositeQuality(blended)).toBeGreaterThan(4);
  });
});

describe('QualityGateService decision', () => {
  /** An LLM judge that returns whatever the test hands it. */
  const gateWith = (verdict: unknown) =>
    new QualityGateService(
      { chatJson: async () => ({ data: verdict }) } as never,
      config,
    );
  const glowing = {
    pass: true,
    scores: { authenticity: 10, aiGenericness: 0, hook: 10, originality: 10 },
  };

  it('approves a curated breakdown', async () => {
    const result = await gateWith(glowing).evaluate({
      hook: CURATED_HOOK,
      postText: CURATED_POST,
    });
    expect(result.decision).toBe('approved');
  });

  it('sends back a fabricated first-person post even when the LLM judge loves it', async () => {
    const result = await gateWith(glowing).evaluate({
      hook: FABRICATED_HOOK,
      postText: FABRICATED_POST,
    });
    expect(result.decision).toBe('regenerate');
    expect(result.reasons.join(' | ')).toMatch(/fabricated first-person claims/);
    expect(result.reasons.join(' | ')).toMatch(/banned phrases/);
    expect(result.feedback).toMatch(/third person/);
  });

  it('sends back posts that carry a link or miss the format', async () => {
    const linked = await gateWith(glowing).evaluate({
      hook: CURATED_HOOK,
      postText: `${CURATED_POST}\n\nPrimary source:\nhttps://dev.to/some_user/engine`,
    });
    expect(linked.decision).toBe('regenerate');
    expect(linked.reasons).toContain('external link in post body');

    const wall = await gateWith(glowing).evaluate({
      hook: CURATED_HOOK,
      postText: CURATED_POST.replace(/^- /gm, ''),
    });
    expect(wall.decision).toBe('regenerate');
    expect(wall.reasons).toContain('no bulleted breakdown');
  });

  it('still decides when the LLM judge is unavailable', async () => {
    const offline = new QualityGateService(
      {
        chatJson: async () => {
          throw new Error('offline');
        },
      } as never,
      config,
    );
    expect(
      (await offline.evaluate({ hook: CURATED_HOOK, postText: CURATED_POST }))
        .decision,
    ).toBe('approved');
    expect(
      (
        await offline.evaluate({
          hook: FABRICATED_HOOK,
          postText: FABRICATED_POST,
        })
      ).decision,
    ).toBe('regenerate');
  });

  it('rejects once regenerations are exhausted', async () => {
    const result = await gateWith(glowing).evaluate({
      hook: FABRICATED_HOOK,
      postText: FABRICATED_POST,
      regenerationCount: config.maxRegenerationAttempts(),
    });
    expect(result.decision).toBe('rejected');
  });
});
