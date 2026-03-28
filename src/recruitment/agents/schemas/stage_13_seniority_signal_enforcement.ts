import { z } from 'zod';
import {
  AmbiguityLevelSchema,
  ExperienceFormatSchema,
  ImpactHorizonSchema,
  Score0To100Schema,
  ScopeLevelSchema,
  SeniorityClassSchema,
  SeniorityTrackSchema,
  SkillRepresentationModeSchema,
  StringArraySchema,
} from './common.js';

export const SenioritySignalEnforcementSchema = z.object({
  target_seniority_class: SeniorityClassSchema,
  candidate_seniority_class: SeniorityClassSchema,
  target_seniority_level: z.string(),
  candidate_seniority_level: z.string(),
  seniority_track: SeniorityTrackSchema.optional(),
  scope_level: ScopeLevelSchema.optional(),
  impact_horizon: ImpactHorizonSchema.optional(),
  ambiguity_level: AmbiguityLevelSchema.optional(),
  skill_representation_mode: SkillRepresentationModeSchema,
  experience_format: ExperienceFormatSchema,
  seniority_gap: z.string(),
  inflation_risk: Score0To100Schema,
  missing_signals: StringArraySchema,
  rewrite_constraints: StringArraySchema,
  target_seniority_rationale: z.string().optional(),
});

export type SenioritySignalEnforcement = z.infer<typeof SenioritySignalEnforcementSchema>;
