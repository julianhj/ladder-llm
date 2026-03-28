import { z } from 'zod';
import { Score0To100Schema, StringArraySchema } from './common.js';

const WeightedScoresSchema = z.object({
  technical: Score0To100Schema,
  leadership: Score0To100Schema,
  execution: Score0To100Schema,
  culture: Score0To100Schema,
}).default({ technical: 0, leadership: 0, execution: 0, culture: 0 });

export const PanelWeightingSchema = z.object({
  weighted_scores: WeightedScoresSchema,
  panel_confidence: Score0To100Schema,
  panel_risk_flags: StringArraySchema,
});

export type PanelWeighting = z.infer<typeof PanelWeightingSchema>;
