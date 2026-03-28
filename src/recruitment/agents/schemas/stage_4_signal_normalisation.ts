import { z } from 'zod';
import {
  SignalCategoryArraysSchema,
  SignalCategoryScoresSchema,
  StringArraySchema,
} from './common.js';

export const SignalNormalizedSchema = z.object({
  aggregated_signals: SignalCategoryArraysSchema,
  confidence_scores: SignalCategoryScoresSchema,
  signal_gaps: StringArraySchema,
});

export type SignalNormalized = z.infer<typeof SignalNormalizedSchema>;
