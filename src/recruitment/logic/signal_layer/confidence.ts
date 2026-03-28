/**
 * Signal confidence model: agreement between agents, variance penalty, missing signal penalty.
 * Optional layer consumed by Consensus and downstream stages.
 */

import type { SignalGraph } from './signalGraph.js';

const VARIANCE_PENALTY_FACTOR = 0.5;
const MISSING_SIGNAL_PENALTY_PER_KEY = 5;
const EVIDENCE_MISSING_PENALTY = 10;
const REQUIRED_KEYS = [
  'execution.delivery_consistency',
  'execution.execution_maturity',
  'leadership.scope_level',
  'business.business_alignment',
  'seniority.scope_level',
  'risk.delivery_risk',
] as const;

function getNested(graph: SignalGraph, path: string): number | undefined {
  const [cat, key] = path.split('.');
  const record = (graph as unknown as Record<string, Record<string, number>>)[cat];
  if (!record || typeof record !== 'object') return undefined;
  const v = record[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Compute overall confidence 0-100 from the signal graph.
 * confidence = agreement - variance_penalty - missing_signal_penalty
 */
export function computeConfidence(graph: SignalGraph): number {
  let score = 100;

  // Variance penalty: use confidence sub-record if present (built by signalGraph when variance > threshold)
  const conf = graph.confidence ?? {};
  const variancePenalties = Object.values(conf).filter(v => v < 100 && v >= 0);
  if (variancePenalties.length > 0) {
    const avgReduction = variancePenalties.reduce((a, b) => a + (100 - b), 0) / variancePenalties.length;
    score -= avgReduction * VARIANCE_PENALTY_FACTOR;
  }

  // Missing signal penalty
  let missing = 0;
  for (const path of REQUIRED_KEYS) {
    const v = getNested(graph, path);
    if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) missing++;
  }
  score -= missing * MISSING_SIGNAL_PENALTY_PER_KEY;

  // Evidence missing penalty: when no evidence items, apply confidence penalty
  const evidenceCount = graph.evidence?.length ?? 0;
  if (evidenceCount === 0) score -= EVIDENCE_MISSING_PENALTY;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Return per-category confidence record for downstream (e.g. Consensus).
 * Merges graph.confidence with an overall key.
 */
export function computeConfidenceScores(graph: SignalGraph): Record<string, number> {
  const overall = computeConfidence(graph);
  const out: Record<string, number> = { ...(graph.confidence ?? {}), overall };
  return out;
}
