import { z } from 'zod';

/** Stage 2: Role success model output. */
export const RoleSuccessProfileSchema = z.object({
  ownership_level: z.string().optional(),
  strategic_thinking: z.array(z.string()).default([]),
  cross_team_influence: z.array(z.string()).default([]),
  execution_expectations: z.array(z.string()).default([]),
  leadership_scope: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
}).passthrough();

export type RoleSuccessProfile = z.infer<typeof RoleSuccessProfileSchema>;
