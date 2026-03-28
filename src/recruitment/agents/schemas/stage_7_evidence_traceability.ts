import { z } from 'zod';
import { Score0To100Schema } from './common.js';

/** One evidence-traceability entry per input signal: links that signal to evidence refs from CV/JD/assessments. */
const EvidenceTraceabilityEntrySchema = z.object({
  signal: z.string(),
  evidence_refs: z.array(z.string()),
  confidence: Score0To100Schema.optional(),
});

/** Stage 7: Evidence traceability output. Arrays map 1:1 to stage_6 scope_signals, execution_signals, etc. */
export const EvidenceTraceabilitySchema = z.object({
  scope: z.array(EvidenceTraceabilityEntrySchema).default([]),
  execution: z.array(EvidenceTraceabilityEntrySchema).default([]),
  leadership: z.array(EvidenceTraceabilityEntrySchema).default([]),
  business: z.array(EvidenceTraceabilityEntrySchema).default([]),
  risk: z.array(EvidenceTraceabilityEntrySchema).default([]),
  traceability_map: z.record(z.string(), z.array(z.string())).optional(),
}).passthrough();

export type EvidenceTraceability = z.infer<typeof EvidenceTraceabilitySchema>;
