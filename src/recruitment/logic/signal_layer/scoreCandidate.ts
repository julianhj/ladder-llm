/**
 * Deterministic scoring from SignalGraph. No LLM calls.
 * Consensus agent receives computed_score and final_decision; it does not calculate them.
 */

import type { SignalGraph } from './signalGraph.js';

export type FinalDecision = 'hire' | 'maybe' | 'declined';

/** Decision thresholds: 0-59 declined, 60-79 maybe, 80-100 hire */
const THRESHOLD_DECLINED_MAX = 59;
const THRESHOLD_MAYBE_MAX = 79;

/**
 * Weights applied to signal graph dimensions (must sum to 1.0).
 * Keys must match SignalGraph shape from signalGraph.ts.
 */
const DEFAULT_WEIGHTS = {
  execution: 0.30,
  leadership: 0.25,
  business: 0.20,
  seniority: 0.15,
  risk: 0.10,
} as const;

function getOrZero(record: Record<string, number>, key: string): number {
  const v = record[key];
  return typeof v === 'number' && !Number.isNaN(v) ? Math.max(0, Math.min(100, v)) : 0;
}

/**
 * Compute overall score 0-100 from the signal graph.
 * Uses: delivery_consistency (execution), scope_level (leadership), business_alignment, seniority scope_level, inverse of delivery_risk.
 */
export function computeScore(graph: SignalGraph, weights?: Partial<typeof DEFAULT_WEIGHTS>): number {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const deliveryConsistency = getOrZero(graph.execution, 'delivery_consistency') || getOrZero(graph.execution, 'execution_maturity');
  const scopeLevel = getOrZero(graph.leadership, 'scope_level') || getOrZero(graph.leadership, 'leadership_strength');
  const businessAlignment = getOrZero(graph.business, 'business_alignment');
  const seniorityScope = getOrZero(graph.seniority, 'scope_level');
  const deliveryRisk = getOrZero(graph.risk, 'delivery_risk');
  const riskComponent = 100 - deliveryRisk;

  const score =
    deliveryConsistency * w.execution +
    scopeLevel * w.leadership +
    businessAlignment * w.business +
    seniorityScope * w.seniority +
    riskComponent * w.risk;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Map computed score to final decision using fixed thresholds.
 */
export function scoreToFinalDecision(score: number): FinalDecision {
  if (score <= THRESHOLD_DECLINED_MAX) return 'declined';
  if (score <= THRESHOLD_MAYBE_MAX) return 'maybe';
  return 'hire';
}

/**
 * Compute score and final decision from the signal graph.
 */
export function computeScoreAndDecision(
  graph: SignalGraph,
  weights?: Partial<typeof DEFAULT_WEIGHTS>
): { computed_score: number; final_decision: FinalDecision } {
  const computed_score = computeScore(graph, weights);
  const final_decision = scoreToFinalDecision(computed_score);
  return { computed_score, final_decision };
}
