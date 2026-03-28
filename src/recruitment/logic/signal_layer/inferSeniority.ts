/**
 * Infer seniority level from SignalGraph (code-only). No LLM calls.
 * Used for CV Optimizer tone, rewrite constraints, and Recruiter Reality validation thresholds.
 */

import type { SignalGraph } from './signalGraph.js';

export type InferredSeniority = 'director' | 'head_of' | 'manager' | 'senior_ic';

const THRESHOLD_DIRECTOR = 80;
const THRESHOLD_HEAD_OF = 65;
const THRESHOLD_MANAGER = 50;

function getScopeLevel(graph: SignalGraph): number {
  const fromLeadership = graph.leadership?.scope_level ?? graph.leadership?.leadership_strength ?? 0;
  const fromSeniority = graph.seniority?.scope_level ?? 0;
  if (fromLeadership > 0 && fromSeniority > 0) {
    return (fromLeadership + fromSeniority) / 2;
  }
  return fromLeadership > 0 ? fromLeadership : fromSeniority;
}

/**
 * Infer seniority from leadership/seniority scope signals.
 * Thresholds: >80 director, >65 head_of, >50 manager, else senior_ic.
 */
export function inferSeniority(graph: SignalGraph): InferredSeniority {
  const scopeLevel = getScopeLevel(graph);
  if (scopeLevel > THRESHOLD_DIRECTOR) return 'director';
  if (scopeLevel > THRESHOLD_HEAD_OF) return 'head_of';
  if (scopeLevel > THRESHOLD_MANAGER) return 'manager';
  return 'senior_ic';
}
