/**
 * Signal Calibration Layer — clamp normalised signals to 0-100 for downstream consumers.
 * Evidence items on the graph are for traceability, UI, and prompts; they are not used to
 * rescale numeric scores (no evidence-confidence blending or coverage/risk dampening).
 * No LLM calls.
 */

import type { SignalGraph } from './signalGraph.js';

export type SkillRepresentationMode = 'keywords' | 'narrative';

/**
 * Resolve skill representation mode from Stage 7 LLM output.
 * When the LLM provides skill_representation_mode (Stage 7 ran successfully), use it.
 * When not provided (Stage 7 did not run or failed), return explicit default 'keywords'.
 * No regex or role-title interpretation; fully LLM-driven when Stage 7 is available.
 */
export function inferSkillRepresentationMode(input: {
  llmSkillRepresentationMode?: SkillRepresentationMode;
}): SkillRepresentationMode {
  const mode = input.llmSkillRepresentationMode;
  if (mode === 'narrative' || mode === 'keywords') return mode;
  return 'keywords';
}

export interface CalibratedSignalGraph extends SignalGraph {
  calibrated_scores: Record<string, number>;
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Flatten all numeric signal values from graph (excl. confidence) into a single record with dotted keys */
function flattenScores(graph: SignalGraph): Record<string, number> {
  const out: Record<string, number> = {};
  const categories = ['execution', 'leadership', 'business', 'seniority', 'risk'] as const;
  for (const cat of categories) {
    const record = graph[cat];
    if (record && typeof record === 'object') {
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === 'number') out[`${cat}.${k}`] = v;
      }
    }
  }
  return out;
}

/**
 * Calibrate the signal graph: clamp each flattened dimension to 0-100.
 * @param _evidenceCoverageScore Retained for call-site compatibility; not used for rescaling.
 */
export function calibrateSignals(
  graph: SignalGraph,
  _evidenceCoverageScore: number
): CalibratedSignalGraph {
  const flat = flattenScores(graph);
  const calibrated_scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(flat)) {
    calibrated_scores[key] = clamp100(value);
  }

  if (Object.keys(calibrated_scores).length === 0) {
    calibrated_scores.overall = 0;
  }

  return {
    ...graph,
    calibrated_scores,
  };
}
