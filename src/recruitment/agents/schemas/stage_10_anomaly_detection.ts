import { z } from 'zod';
import { Score0To100Schema, StringArraySchema } from './common.js';

export const AnomalyDetectionSchema = z.object({
  anomaly_detected: z.boolean(),
  anomaly_type: z.array(z.enum(['inflated_claims', 'inconsistent_scoring', 'missing_signals'])).default([]),
  confidence_score: Score0To100Schema,
  affected_fields: StringArraySchema,
});
