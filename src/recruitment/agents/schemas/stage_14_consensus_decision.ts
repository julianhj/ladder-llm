import { z } from 'zod';
import {
  AssessmentResultBaseObjectSchema,
  DecisionEnumSchema,
  Score0To100Schema,
  SectionSchema,
  StringArraySchema,
} from './common.js';

export const CvRewriteStrategySchema = z.object({
  positioning_signals: StringArraySchema,
  gap_signals: StringArraySchema,
  rewrite_directives: StringArraySchema,
  tone_adjustments: StringArraySchema,
  seniority_alignment: StringArraySchema,
});

/** Consensus output: same shape as assessment base + extra fields. Sections may be a subset of types; downstream should handle missing section types defensively. */
export const ConsensusResultSchema = AssessmentResultBaseObjectSchema.extend({
  final_decision: DecisionEnumSchema,
  confidence: Score0To100Schema,
  reasoning: SectionSchema,
  cv_rewrite_strategy: SectionSchema,
  director_signal_strength: SectionSchema,
  validated_strengths: SectionSchema,
  validated_gaps: SectionSchema,
  risk_flags: SectionSchema,
  rewrite_constraints: SectionSchema,
  partial_assessments: SectionSchema.optional(),
  demonstrated_strengths: StringArraySchema.optional(),
  declared_skills_to_validate: StringArraySchema.optional(),
  growth_potential: SectionSchema,
  leadership_level: SectionSchema,
  cultural_fit_level: SectionSchema,
  team_integration_potential: SectionSchema,
});

export type CvRewriteStrategy = z.infer<typeof CvRewriteStrategySchema>;
export type ConsensusResult = z.infer<typeof ConsensusResultSchema>;
