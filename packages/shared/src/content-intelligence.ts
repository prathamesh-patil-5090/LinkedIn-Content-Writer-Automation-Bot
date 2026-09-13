import { z } from 'zod';

export const ContentPillar = z.enum([
  'engineering',
  'build_in_public',
  'product',
  'personal',
]);
export type ContentPillar = z.infer<typeof ContentPillar>;

export const ContentFormat = z.enum([
  'engineering_story',
  'technical_breakdown',
  'build_in_public',
  'educational',
  'opinion',
  'failure_mistake',
  'experiment',
  'product_decision',
  'architecture_breakdown',
  'before_after',
  'technical_lesson',
  'case_study',
]);
export type ContentFormat = z.infer<typeof ContentFormat>;

export const DEFAULT_PILLAR_WEIGHTS: Record<ContentPillar, number> = {
  engineering: 0.4,
  build_in_public: 0.3,
  product: 0.2,
  personal: 0.1,
};

export const OpportunityScoresSchema = z.object({
  technicalNovelty: z.number().min(0).max(10),
  educationalValue: z.number().min(0).max(10),
  practicalValue: z.number().min(0).max(10),
  personalExperience: z.number().min(0).max(10),
  problemSeverity: z.number().min(0).max(10),
  storyPotential: z.number().min(0).max(10),
  discussionPotential: z.number().min(0).max(10),
  visualPotential: z.number().min(0).max(10),
  audienceRelevance: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
});
export type OpportunityScores = z.infer<typeof OpportunityScoresSchema>;

export const SCORE_WEIGHTS: Record<keyof OpportunityScores, number> = {
  technicalNovelty: 0.1,
  educationalValue: 0.15,
  practicalValue: 0.15,
  personalExperience: 0.1,
  problemSeverity: 0.1,
  storyPotential: 0.15,
  discussionPotential: 0.1,
  visualPotential: 0.05,
  audienceRelevance: 0.05,
  originality: 0.05,
};

export function weightedContentScore(scores: OpportunityScores): number {
  let sum = 0;
  for (const [k, w] of Object.entries(SCORE_WEIGHTS) as Array<
    [keyof OpportunityScores, number]
  >) {
    sum += (scores[k] ?? 0) * w;
  }
  return Math.round(sum * 100) / 100;
}

export const QualityScoresSchema = z.object({
  technicalAccuracy: z.number().min(0).max(10),
  authenticity: z.number().min(0).max(10),
  hook: z.number().min(0).max(10),
  educationalValue: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  readability: z.number().min(0).max(10),
  storytelling: z.number().min(0).max(10),
  relevance: z.number().min(0).max(10),
  aiGenericness: z.number().min(0).max(10),
  repetition: z.number().min(0).max(10),
  factualGrounding: z.number().min(0).max(10),
});
export type QualityScores = z.infer<typeof QualityScoresSchema>;

export const AngleCandidateSchema = z.object({
  label: z.string(),
  angle: z.string(),
  format: ContentFormat.optional(),
  score: z.number().min(0).max(10),
  rationale: z.string().optional(),
});
export type AngleCandidate = z.infer<typeof AngleCandidateSchema>;

export const HookCandidateSchema = z.object({
  text: z.string(),
  category: z.string(),
  score: z.number().min(0).max(10),
});
export type HookCandidate = z.infer<typeof HookCandidateSchema>;

export const AutoDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'regenerate']),
  reasons: z.array(z.string()),
  contentScore: z.number().optional(),
  qualityScore: z.number().optional(),
  authenticityScore: z.number().optional(),
  aiGenericnessScore: z.number().optional(),
  repetitionScore: z.number().optional(),
  diversityScore: z.number().optional(),
  pillar: ContentPillar.optional(),
  format: ContentFormat.optional(),
  selectedAngle: z.string().optional(),
  selectedHook: z.string().optional(),
  regenerationCount: z.number().optional(),
});
export type AutoDecision = z.infer<typeof AutoDecisionSchema>;

export const GENERIC_PHRASES = [
  'excited to announce',
  'game changer',
  'game-changer',
  'revolutionary',
  'unlock the power',
  "in today's fast-paced",
  'let that sink in',
  'agree?',
  'thoughts?',
  'follow for more',
  "here's the thing",
  "let's dive in",
  'thrilled to',
  'humbled to',
  'as a developer',
  'as developers we',
  'synergy',
  'disrupt',
];
