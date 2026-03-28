/**
 * Signal Confidence Aggregation — deterministic stage that computes a
 * meta-confidence summary from calibrated signals, panel weighting, evidence,
 * and traceability. No LLM. Output is used by Consensus and Audit.
 */

export type SignalStability = 'low' | 'medium' | 'high';
export type EvidenceDensity = 'low' | 'medium' | 'high';

export interface SignalConfidenceOutput {
  decision_confidence: number;
  signal_stability: SignalStability;
  evidence_density: EvidenceDensity;
  interviewer_agreement: number;
  anomaly_penalty: number;
}

export interface SignalConfidenceAggregationResult {
  signal_confidence: SignalConfidenceOutput;
  computed_metrics: {
    evidence_strength: number;
    interviewer_agreement_raw: number;
    panel_weight_consistency: number;
    signal_variance: number;
  };
  runtime_ms: number;
}

/** Minimal stage result shape to avoid circular dependency on PipelineRunner */
interface StageResultInput {
  stageId: string;
  results: Array< { success: boolean; result?: unknown }>;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
}

/**
 * Compute signal confidence aggregation from stages 4, 5, 6, 7, 8.
 * Anomaly is not yet run at this stage, so anomaly_penalty is 0.
 */
export function aggregateSignalConfidence(
  mainStageResults: StageResultInput[],
  runtimeMs: number
): SignalConfidenceAggregationResult {
  const stage5 = mainStageResults.find(s => s.stageId === 'stage_5_interview_calibration');
  const stage6 = mainStageResults.find(s => s.stageId === 'stage_6_evidence_synthesiser');
  const stage8 = mainStageResults.find(s => s.stageId === 'stage_8_panel_weighting');

  const r5 = stage5?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r6 = stage6?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r8 = stage8?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;

  // Evidence strength: from evidence synthesiser signal_confidence (0-100); normalise to 0-1
  const sigConf = r6?.signal_confidence as Record<string, unknown> | undefined;
  const scopeConf = typeof sigConf?.scope === 'number' ? Math.max(0, Math.min(100, sigConf.scope)) / 100 : 0.5;
  const execConf = typeof sigConf?.execution === 'number' ? Math.max(0, Math.min(100, sigConf.execution)) / 100 : 0.5;
  const leadConf = typeof sigConf?.leadership === 'number' ? Math.max(0, Math.min(100, sigConf.leadership)) / 100 : 0.5;
  const busConf = typeof sigConf?.business === 'number' ? Math.max(0, Math.min(100, sigConf.business)) / 100 : 0.5;
  const evidence_strength = (scopeConf + execConf + leadConf + busConf) / 4;

  // Interviewer agreement: inverse of variance of calibrated scores or panel scores
  const calibratedScores = r5?.calibrated_scores as Record<string, number> | undefined;
  const weighted = r8?.weighted_scores as Record<string, unknown> | undefined;
  const to01 = (v: unknown): number => {
    if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.min(100, v)) / 100;
    return 0.5;
  };
  const panelScores = weighted
    ? [
        to01((weighted as Record<string, unknown>).technical),
        to01((weighted as Record<string, unknown>).leadership),
        to01((weighted as Record<string, unknown>).execution),
        to01((weighted as Record<string, unknown>).culture),
      ]
    : [];
  const scoresForVariance =
    calibratedScores && Object.keys(calibratedScores).length > 0
      ? Object.values(calibratedScores).map(v => (typeof v === 'number' ? v / 100 : 0.5))
      : panelScores.length > 0
        ? panelScores
        : [0.5];
  const signal_variance = variance(scoresForVariance);
  const interviewer_agreement_raw = Math.max(0, 1 - signal_variance * 4); // scale variance to 0-1 band

  // Panel weight consistency: panel_confidence as 0-1
  const panelConf =
    typeof r8?.panel_confidence === 'number'
      ? Math.max(0, Math.min(100, r8.panel_confidence)) / 100
      : 0.5;
  const panel_weight_consistency = panelConf;

  // Anomaly not run yet
  const anomaly_penalty = 0;

  // decision_confidence = evidence_strength + interviewer_agreement - anomaly_penalty, normalised 0-1
  const decision_confidence = Math.max(
    0,
    Math.min(1, evidence_strength * 0.5 + interviewer_agreement_raw * 0.5 - anomaly_penalty)
  );

  // Bands for stability and density
  const toStability = (v: number): SignalStability =>
    v >= 0.6 ? 'high' : v >= 0.35 ? 'medium' : 'low';
  const toDensity = (v: number): EvidenceDensity =>
    v >= 0.6 ? 'high' : v >= 0.35 ? 'medium' : 'low';

  const signal_stability = toStability(interviewer_agreement_raw);
  const evidence_density = toDensity(evidence_strength);

  const signal_confidence: SignalConfidenceOutput = {
    decision_confidence,
    signal_stability,
    evidence_density,
    interviewer_agreement: interviewer_agreement_raw,
    anomaly_penalty,
  };

  return {
    signal_confidence,
    computed_metrics: {
      evidence_strength,
      interviewer_agreement_raw,
      panel_weight_consistency,
      signal_variance,
    },
    runtime_ms: runtimeMs,
  };
}
