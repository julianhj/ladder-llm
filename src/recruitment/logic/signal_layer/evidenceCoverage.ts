/**
 * Evidence coverage scoring: fraction of signals that have at least one evidence item.
 * Used for credibility, inflation detection, and rewrite constraints.
 */

import type { SignalGraph } from './signalGraph.js';

/** Collect all numeric signal keys from execution, leadership, business, seniority, risk (not confidence) */
function getAllSignalKeys(graph: SignalGraph): string[] {
  const keys: string[] = [];
  const categories = ['execution', 'leadership', 'business', 'seniority', 'risk'] as const;
  for (const cat of categories) {
    const record = graph[cat];
    if (record && typeof record === 'object') {
      for (const k of Object.keys(record)) {
        if (typeof (record as Record<string, number>)[k] === 'number') {
          keys.push(`${cat}.${k}`);
        }
      }
    }
  }
  return keys;
}

export function countSignals(graph: SignalGraph): number {
  return getAllSignalKeys(graph).length;
}

export function countSignalsWithEvidence(graph: SignalGraph): number {
  const allKeys = new Set(getAllSignalKeys(graph));
  const evidence = graph.evidence ?? [];
  const mappedKeys = new Set<string>();
  for (const item of evidence) {
    if (item.signal_key && allKeys.has(item.signal_key)) {
      mappedKeys.add(item.signal_key);
    }
  }
  return mappedKeys.size;
}

/**
 * Returns evidence_coverage_score 0-100. Safe: returns 0 when totalSignals === 0.
 */
export function computeEvidenceCoverage(graph: SignalGraph): number {
  const total = countSignals(graph);
  if (total === 0) return 0;
  const mapped = countSignalsWithEvidence(graph);
  return Math.round((mapped / total) * 100);
}
