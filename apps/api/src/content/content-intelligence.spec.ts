import {
  weightedContentScore,
  type OpportunityScores,
  DEFAULT_PILLAR_WEIGHTS,
} from '@ldp/shared';

describe('content intelligence scoring', () => {
  it('weights opportunity scores into a contentScore', () => {
    const scores: OpportunityScores = {
      technicalNovelty: 10,
      educationalValue: 10,
      practicalValue: 10,
      personalExperience: 10,
      problemSeverity: 10,
      storyPotential: 10,
      discussionPotential: 10,
      visualPotential: 10,
      audienceRelevance: 10,
      originality: 10,
    };
    expect(weightedContentScore(scores)).toBe(10);
  });

  it('defaults pillar weights to 40/30/20/10', () => {
    expect(DEFAULT_PILLAR_WEIGHTS.engineering).toBeCloseTo(0.4);
    expect(DEFAULT_PILLAR_WEIGHTS.build_in_public).toBeCloseTo(0.3);
    expect(DEFAULT_PILLAR_WEIGHTS.product).toBeCloseTo(0.2);
    expect(DEFAULT_PILLAR_WEIGHTS.personal).toBeCloseTo(0.1);
  });
});
