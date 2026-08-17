import { z } from 'zod';

export const RunStatus = z.enum([
  'collecting',
  'researching',
  'ranking',
  'writing',
  'imaging',
  'pending_approval',
  'publishing',
  'published',
  'regenerating',
  'skipped',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const DraftStatus = z.enum([
  'pending',
  'approved',
  'superseded',
  'rejected',
]);
export type DraftStatus = z.infer<typeof DraftStatus>;

export const VoiceSampleSource = z.enum([
  'manual',
  'linkedin_export',
  'published_by_app',
  'seed',
]);
export type VoiceSampleSource = z.infer<typeof VoiceSampleSource>;

export const StorySchema = z.object({
  rank: z.number().int().optional(),
  title: z.string(),
  link: z.string().url(),
  why_it_matters: z.string().optional(),
  trend_score: z.number().optional(),
  angle: z.string().optional(),
  summary: z.string().optional(),
  source: z.string().optional(),
  published_at: z.string().optional(),
});
export type Story = z.infer<typeof StorySchema>;

export const VoiceOutputSchema = z.object({
  post_text: z.string().min(200),
  hook: z.string().min(1),
  image_prompt: z.string().min(1),
  hashtags: z.array(z.string()).max(5).default([]),
  chosen_style: z.string(),
  source_title: z.string(),
  source_link: z.string(),
});
export type VoiceOutput = z.infer<typeof VoiceOutputSchema>;

export const GENERATING_STATUSES: RunStatus[] = [
  'collecting',
  'researching',
  'ranking',
  'writing',
  'imaging',
  'regenerating',
];

export function isGenerating(status: RunStatus): boolean {
  return GENERATING_STATUSES.includes(status);
}
