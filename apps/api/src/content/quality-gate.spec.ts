import { QualityGateService } from './quality-gate.service';
import { ContentConfigService } from './content-config.service';
import { ConfigService } from '@nestjs/config';

describe('QualityGateService heuristic', () => {
  const gate = new QualityGateService(
    {} as never,
    new ContentConfigService(new ConfigService({})),
  );

  it('flags generic LinkedIn fluff', () => {
    const result = gate.heuristicEvaluate({
      hook: 'Excited to announce something',
      postText:
        "Excited to announce a game changer. In today's fast-paced world, let's dive in. Thoughts?",
      sourceTitle: 'Thing',
    });
    expect(result.scores.aiGenericness).toBeGreaterThan(3);
    expect(result.reasons.some((r) => /generic/i.test(r))).toBe(true);
  });

  it('penalizes ungrounded percentages', () => {
    const result = gate.heuristicEvaluate({
      hook: 'We cut latency hard',
      postText:
        'We improved everything by 87% last week and users loved it across the board without measuring anything.',
    });
    expect(result.scores.factualGrounding).toBeLessThan(5);
  });

  it('composite quality stays in 0-10 for a solid builder post', () => {
    const h = gate.heuristicEvaluate({
      hook: 'I almost shipped the wrong fix',
      postText:
        'I almost shipped the wrong fix for a cache stampede.\n\nHere is what broke, why the retry loop made it worse, and the boring guard that fixed it.\n\nMeasure first, then change.',
    });
    const q = gate.compositeQuality(h.scores);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(10);
    expect(q).toBeGreaterThan(5);
  });

  it('does not let harsh LLM scores zero out a solid heuristic base', () => {
    const base = gate.heuristicEvaluate({
      hook: 'I almost shipped the wrong fix',
      postText:
        'I almost shipped the wrong fix for a cache stampede.\n\nHere is what broke, why the retry loop made it worse, and the boring guard that fixed it.\n\nMeasure first, then change.',
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
