import { z } from 'zod';
import { StringArraySchema } from './common.js';

/** Stage 11: Counterfactual challenge report. */
export const CounterfactualChallengeReportSchema = z.object({
  alternative_interpretations: StringArraySchema,
  risk_implications: StringArraySchema,
  challenged_claims: z.array(z.object({ claim: z.string(), alternative: z.string().optional() })).default([]),
  team_vs_individual: StringArraySchema,
  strength_challenges: StringArraySchema,
}).passthrough();

export type CounterfactualChallengeReport = z.infer<typeof CounterfactualChallengeReportSchema>;
