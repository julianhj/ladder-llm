import { z } from 'zod';
import { SignalCategoryScoresSchema, StringArraySchema } from './common.js';

const CalibratedSignalsValueSchema = z.union([z.number(), z.array(z.string())]);
const CalibratedSignalsMapSchema = z
  .object({
    technical_scope: CalibratedSignalsValueSchema.optional(),
    execution_authority: CalibratedSignalsValueSchema.optional(),
    leadership_impact: CalibratedSignalsValueSchema.optional(),
    business_alignment: CalibratedSignalsValueSchema.optional(),
    delivery_risk: CalibratedSignalsValueSchema.optional(),
  })
  .default({});

/** Stage 5: Interview calibration output. */
export const CalibratedSignalsSchema = z.object({
  calibrated_scores: SignalCategoryScoresSchema,
  calibrated_signals: CalibratedSignalsMapSchema,
  comparable_dimensions: StringArraySchema,
}).passthrough();

export type CalibratedSignals = z.infer<typeof CalibratedSignalsSchema>;
