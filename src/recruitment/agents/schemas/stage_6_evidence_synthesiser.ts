import { z } from 'zod';
import { Score0To100Schema, StringArraySchema } from './common.js';

const SignalConfidenceSchema = z.object({
  scope: Score0To100Schema,
  execution: Score0To100Schema,
  leadership: Score0To100Schema,
  business: Score0To100Schema,
}).default({ scope: 0, execution: 0, leadership: 0, business: 0 });

export const EvidenceSynthesiserSchema = z.object({
  scope_signals: StringArraySchema,
  execution_signals: StringArraySchema,
  leadership_signals: StringArraySchema,
  business_signals: StringArraySchema,
  risk_signals: StringArraySchema,
  signal_confidence: SignalConfidenceSchema,
  evidence_template_applied: z.boolean().default(false),
  template_name: z.string().optional(),
  template_description: z.string().optional(),
  signal_gaps_against_template: StringArraySchema,
});

export type EvidenceSynthesiser = z.infer<typeof EvidenceSynthesiserSchema>;
