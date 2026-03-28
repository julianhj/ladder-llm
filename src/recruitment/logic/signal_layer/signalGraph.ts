/**
 * Signal Graph Builder — deterministic layer that merges Stage 1, 1.5, 2A, 2B
 * into a single typed SignalGraph. No LLM calls.
 */

import type { EvidenceItem } from './buildEvidence.js';

export interface SignalGraph {
  execution: Record<string, number>;
  leadership: Record<string, number>;
  business: Record<string, number>;
  seniority: Record<string, number>;
  risk: Record<string, number>;
  confidence: Record<string, number>;
  /** Evidence items linking signals to CV/JD excerpts; default [] for backward compatibility */
  evidence: EvidenceItem[];
}

/** Input: array of agent results with optional parsed .result */
export interface StageResultInput {
  result?: unknown;
  success?: boolean;
}

const DEFAULT_VARIANCE_THRESHOLD = 25;
const DEFAULT_CONFIDENCE_REDUCTION = 20;

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.min(100, v));
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return Math.max(0, Math.min(100, n));
  }
  return null;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = avg(values);
  return values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
}

function objNum(o: unknown, key: string): number | null {
  if (o == null || typeof o !== 'object') return null;
  const v = (o as Record<string, unknown>)[key];
  return safeNum(v);
}

/**
 * Builds a SignalGraph from Stage 1, 1.5, 2A, 2B results.
 * Maps existing JSON fields to signal contract keys; averages when multiple
 * sources; reduces confidence when variance exceeds threshold.
 * Optionally attaches evidence from the Evidence Layer.
 */
export function buildSignalGraph(
  stage1Results: StageResultInput[],
  signalNormalisationResults: StageResultInput[],
  evidenceSynthesiserResults: StageResultInput[],
  panelWeightingResults: StageResultInput[],
  options?: { varianceThreshold?: number; confidenceReduction?: number; evidenceItems?: EvidenceItem[] }
): SignalGraph {
  const evidenceItems = options?.evidenceItems ?? [];
  const varianceThreshold = options?.varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD;
  const confidenceReduction = options?.confidenceReduction ?? DEFAULT_CONFIDENCE_REDUCTION;

  const execution: Record<string, number> = {};
  const leadership: Record<string, number> = {};
  const business: Record<string, number> = {};
  const seniority: Record<string, number> = {};
  const risk: Record<string, number> = {};
  const confidence: Record<string, number> = {};

  // --- stage_8_panel_weighting — primary numeric source ---
  const pw = panelWeightingResults[0]?.result as Record<string, unknown> | undefined;
  const weighted = pw?.weighted_scores as Record<string, unknown> | undefined;
  if (weighted) {
    execution.delivery_consistency = safeNum(weighted.execution) ?? 0;
    execution.execution_maturity = safeNum(weighted.execution) ?? 0;
    execution.technical = safeNum(weighted.technical) ?? 0;
    leadership.scope_level = safeNum(weighted.leadership) ?? 0;
    leadership.leadership_strength = safeNum(weighted.leadership) ?? 0;
    leadership.leadership = safeNum(weighted.leadership) ?? 0;
    business.culture = safeNum(weighted.culture) ?? 0;
  }
  const panelConf = safeNum(pw?.panel_confidence) ?? 0;
  const panelRiskFlags = Array.isArray(pw?.panel_risk_flags) ? (pw!.panel_risk_flags as unknown[]).length : 0;
  risk.panel_risk_score = Math.max(0, 100 - panelRiskFlags * 10);
  risk.delivery_risk = 100 - (safeNum(pw?.panel_confidence) ?? 0);

  // --- stage_6_evidence_synthesiser — signal_confidence 0-100 ---
  const ev = evidenceSynthesiserResults[0]?.result as Record<string, unknown> | undefined;
  const sigConf = ev?.signal_confidence as Record<string, unknown> | undefined;
  if (sigConf) {
    const execFromEv = safeNum(sigConf.execution);
    const leadFromEv = safeNum(sigConf.leadership);
    const busFromEv = safeNum(sigConf.business);
    const scopeFromEv = safeNum(sigConf.scope);
    if (execFromEv != null) {
      const vals = [execution.execution_maturity ?? 0, execFromEv].filter(Boolean);
      const avgExec = avg(vals);
      execution.execution_maturity = avgExec;
      execution.delivery_consistency = avgExec;
      const v = variance(vals);
      if (v > varianceThreshold) confidence.execution_maturity = Math.max(0, 100 - confidenceReduction);
      else confidence.execution_maturity = 100;
    }
    if (leadFromEv != null) {
      const vals = [(leadership.leadership_strength ?? 0), leadFromEv].filter(Boolean);
      leadership.leadership_strength = avg(vals);
      leadership.scope_level = leadership.leadership_strength;
      const v = variance(vals);
      if (v > varianceThreshold) confidence.leadership = Math.max(0, 100 - confidenceReduction);
      else confidence.leadership = 100;
    }
    if (busFromEv != null) {
      business.business_alignment = busFromEv;
      confidence.business = 100;
    }
    if (scopeFromEv != null) {
      seniority.scope_level = scopeFromEv;
      seniority.delivery_complexity = scopeFromEv;
      seniority.stakeholder_complexity = scopeFromEv;
      confidence.scope = 100;
    }
  }

  // --- stage_4_signal_normalisation — confidence_scores; optional numeric ---
  const signalNormResult = signalNormalisationResults[0]?.result as Record<string, unknown> | undefined;
  const confScores = signalNormResult?.confidence_scores as Record<string, unknown> | undefined;
  if (confScores && typeof confScores === 'object') {
    for (const [k, v] of Object.entries(confScores)) {
      const n = safeNum(v);
      if (n != null) confidence[k] = n;
    }
  }
  if (confidence.panel_confidence === undefined) confidence.panel_confidence = panelConf;

  // --- Stage 1 scores — optional; average interviewer scores for variance ---
  const stage1Scores = stage1Results
    .map(r => objNum((r.result as Record<string, unknown>) ?? {}, 'score'))
    .filter((n): n is number => n != null);
  if (stage1Scores.length > 0) {
    const avgScore = avg(stage1Scores);
    const v = variance(stage1Scores);
    if (execution.execution_maturity === undefined || execution.execution_maturity === 0) {
      execution.execution_maturity = avgScore;
      execution.delivery_consistency = avgScore;
    }
    if (v > varianceThreshold) confidence.overall = Math.max(0, 100 - confidenceReduction);
    else if (confidence.overall === undefined) confidence.overall = 100;
  }

  // Ensure all required keys exist with defaults
  if (execution.delivery_consistency === undefined) execution.delivery_consistency = 0;
  if (execution.execution_maturity === undefined) execution.execution_maturity = 0;
  if (execution.technical === undefined) execution.technical = 0;
  if (leadership.scope_level === undefined) leadership.scope_level = 0;
  if (leadership.leadership_strength === undefined) leadership.leadership_strength = 0;
  if (leadership.leadership === undefined) leadership.leadership = 0;
  if (business.business_alignment === undefined) business.business_alignment = 0;
  if (business.culture === undefined) business.culture = 0;
  if (seniority.scope_level === undefined) seniority.scope_level = 0;
  if (seniority.team_scope === undefined) seniority.team_scope = seniority.scope_level;
  if (seniority.ownership_scope === undefined) seniority.ownership_scope = seniority.scope_level;
  if (seniority.delivery_complexity === undefined) seniority.delivery_complexity = 0;
  if (seniority.stakeholder_complexity === undefined) seniority.stakeholder_complexity = 0;
  if (risk.delivery_risk === undefined) risk.delivery_risk = 0;
  if (risk.panel_risk_score === undefined) risk.panel_risk_score = 100;

  return {
    execution,
    leadership,
    business,
    seniority,
    risk,
    confidence,
    evidence: evidenceItems,
  };
}
