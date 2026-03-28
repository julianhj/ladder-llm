import { z } from 'zod';
import { Score0To100Schema, StringArraySchema } from './common.js';

export const RecruiterRealityValidationSchema = z.object({
  credibility_score: Score0To100Schema,
  inflation_flags: StringArraySchema,
  director_signal_gaps: StringArraySchema,
  weak_evidence_signals: StringArraySchema,
  unsupported_scope_claims: StringArraySchema,
  rewrite_constraints: StringArraySchema,
});

export type RecruiterRealityValidation = z.infer<typeof RecruiterRealityValidationSchema>;
