import { z } from 'zod';
import { SectionSchema } from './common.js';

const CareerTimelineTagSchema = z.enum([
  'promotion',
  'scope_expansion',
  'leadership_growth',
  'domain_shift',
  'lateral_move',
  'tenure_milestone',
]);

export const CareerTimelineItemSchema = z.object({
  role_title: z.string().min(1),
  company: z.string().min(1),
  period_label: z.string().min(1),
  start_date: z.string().min(1).optional(),
  end_date: z.string().min(1).optional(),
  is_current: z.boolean().optional(),
  progression_note: z.string().min(1),
  progression_tags: z.array(CareerTimelineTagSchema).default([]),
  evidence_bullets: z.array(z.string().min(1)).default([]),
});

/** Stage 0: Career trajectory analysis output. */
export const CareerTrajectoryProfileSchema = z.object({
  trajectory_signals: z.array(SectionSchema).default([]),
  career_timeline: z.array(CareerTimelineItemSchema).default([]),
});

export type CareerTimelineItem = z.infer<typeof CareerTimelineItemSchema>;
export type CareerTrajectoryProfile = z.infer<typeof CareerTrajectoryProfileSchema>;
