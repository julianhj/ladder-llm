/**
 * Pre-aggregate for Stage 14 Consensus: compact summary from stages 4, 6, 8, 9, 10, 12, 13.
 * Deterministic; no LLM. Input to Consensus Decision Maker only.
 */

/** Minimal stage result shape to avoid circular dependency on PipelineRunner */
export interface CompactSignalSummaryStageResult {
  stageId: string;
  stageName?: string;
  results: Array<{ success: boolean; result?: unknown }>;
}

export interface SignalConfidenceSummary {
  decision_confidence: number;
  signal_stability: string;
  evidence_density: string;
  interviewer_agreement: number;
  anomaly_penalty: number;
}

/** Short deterministic summary from Stage 7 Evidence Traceability. */
export interface EvidenceTraceabilitySummary {
  scope_count: number;
  execution_count: number;
  leadership_count: number;
  business_count: number;
  risk_count: number;
}

/** Short deterministic summary from Stage 11 Counterfactual Challenge. */
export interface CounterfactualSummary {
  alternative_interpretations_count: number;
  challenged_claims_count: number;
  strength_challenges_count: number;
  risk_implications_count: number;
}

export interface CompactSignalSummary {
  categories: {
    technical_scope: string;
    execution_authority: string;
    leadership_impact: string;
    business_alignment: string;
    delivery_risk: string;
  };
  scores: {
    panel_weighted?: { technical: number; leadership: number; execution: number; culture: number };
    evidence_confidence?: { scope: number; execution: number; leadership: number; business: number };
    panel_confidence?: number;
  };
  anomaly_flags: string[];
  anomaly_affected_fields: string[];
  missing_signals: string[];
  seniority_gap: string;
  rewrite_constraints: string[];
  credibility_score?: number;
  signal_confidence?: SignalConfidenceSummary;
  evidence_traceability?: EvidenceTraceabilitySummary;
  counterfactual?: CounterfactualSummary;
}

function arr(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  return [];
}

function objNum(o: unknown, key: string): number | undefined {
  if (o == null || typeof o !== 'object') return undefined;
  const v = (o as Record<string, unknown>)[key];
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.min(100, v));
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return Math.max(0, Math.min(100, n));
  }
  return undefined;
}

function oneToThreeSentences(items: string[]): string {
  if (items.length === 0) return 'No signals recorded for this category.';
  const trimmed = items.slice(0, 6).map(s => (s || '').trim()).filter(Boolean);
  if (trimmed.length === 0) return 'No signals recorded for this category.';
  if (trimmed.length <= 2) return trimmed.join('. ') + (trimmed.some(s => !s.endsWith('.')) ? '.' : '');
  return trimmed.slice(0, 3).join('. ') + (trimmed[2]?.endsWith('.') ? '' : '.');
}

/**
 * Build compact_signal_summary from stages 4, 6, 7, 8, 9, 10, 11, 12, 13 (and optional signal_layer).
 * Used as deterministic pre-aggregate input to Consensus Decision Maker.
 */
export function buildCompactSignalSummary(
  mainStageResults: CompactSignalSummaryStageResult[],
  _signalLayer: unknown
): CompactSignalSummary {
  const stage4SignalNorm = mainStageResults.find(s => s.stageId === 'stage_4_signal_normalisation');
  const stage6Evidence = mainStageResults.find(s => s.stageId === 'stage_6_evidence_synthesiser');
  const stage7Traceability = mainStageResults.find(s => s.stageId === 'stage_7_evidence_traceability');
  const stage8Panel = mainStageResults.find(s => s.stageId === 'stage_8_panel_weighting');
  const stage9Confidence = mainStageResults.find(s => s.stageId === 'stage_9_signal_confidence_aggregation');
  const stage10Anomaly = mainStageResults.find(s => s.stageId === 'stage_10_anomaly_detection');
  const stage11Counterfactual = mainStageResults.find(s => s.stageId === 'stage_11_counterfactual_challenge');
  const stage12RRV = mainStageResults.find(s => s.stageId === 'stage_12_recruiter_reality_validator');
  const stage13Seniority = mainStageResults.find(s => s.stageId === 'stage_13_seniority_signal_enforcement');

  const r2 = stage4SignalNorm?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r3 = stage6Evidence?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r7Trace = stage7Traceability?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r4 = stage8Panel?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r9Conf = stage9Confidence?.results.find(r => r.success)?.result as { signal_confidence?: SignalConfidenceSummary } | undefined;
  const r5 = stage10Anomaly?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r11Cf = stage11Counterfactual?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r6 = stage12RRV?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;
  const r7 = stage13Seniority?.results.find(r => r.success)?.result as Record<string, unknown> | undefined;

  const agg = r2?.aggregated_signals as Record<string, unknown> | undefined;
  const technical_scope = arr(agg?.technical_scope);
  const execution_authority = arr(agg?.execution_authority);
  const leadership_impact = arr(agg?.leadership_impact);
  const business_alignment = arr(agg?.business_alignment);
  const delivery_risk = arr(agg?.delivery_risk);

  const scopeSignals = arr(r3?.scope_signals);
  const execSignals = arr(r3?.execution_signals);
  const leadSignals = arr(r3?.leadership_signals);
  const busSignals = arr(r3?.business_signals);
  const riskSignals = arr(r3?.risk_signals);

  const sigConf = r3?.signal_confidence as Record<string, unknown> | undefined;
  const weighted = r4?.weighted_scores as Record<string, unknown> | undefined;

  const anomalyDetected = r5?.anomaly_detected === true;
  const anomalyTypes = arr(r5?.anomaly_type);
  const affectedFields = arr(r5?.affected_fields);

  const missingFrom7 = arr(r7?.missing_signals);
  const gapsFrom2 = arr(r2?.signal_gaps);
  const missing_signals = [...new Set([...missingFrom7, ...gapsFrom2])];

  const seniority_gap = typeof r7?.seniority_gap === 'string' ? r7.seniority_gap : '';

  const rewrite6 = arr(r6?.rewrite_constraints);
  const rewrite7 = arr(r7?.rewrite_constraints);
  const rewrite_constraints = [...new Set([...rewrite6, ...rewrite7])];

  const credibility_score = objNum(r6, 'credibility_score');

  const evidence_traceability: EvidenceTraceabilitySummary | undefined = r7Trace
    ? {
        scope_count: Array.isArray(r7Trace.scope) ? r7Trace.scope.length : 0,
        execution_count: Array.isArray(r7Trace.execution) ? r7Trace.execution.length : 0,
        leadership_count: Array.isArray(r7Trace.leadership) ? r7Trace.leadership.length : 0,
        business_count: Array.isArray(r7Trace.business) ? r7Trace.business.length : 0,
        risk_count: Array.isArray(r7Trace.risk) ? r7Trace.risk.length : 0,
      }
    : undefined;

  const counterfactual: CounterfactualSummary | undefined = r11Cf
    ? {
        alternative_interpretations_count: Array.isArray(r11Cf.alternative_interpretations) ? r11Cf.alternative_interpretations.length : 0,
        challenged_claims_count: Array.isArray(r11Cf.challenged_claims) ? r11Cf.challenged_claims.length : 0,
        strength_challenges_count: Array.isArray(r11Cf.strength_challenges) ? r11Cf.strength_challenges.length : 0,
        risk_implications_count: Array.isArray(r11Cf.risk_implications) ? r11Cf.risk_implications.length : 0,
      }
    : undefined;

  return {
    categories: {
      technical_scope: oneToThreeSentences(technical_scope.length > 0 ? technical_scope : scopeSignals),
      execution_authority: oneToThreeSentences(execution_authority.length > 0 ? execution_authority : execSignals),
      leadership_impact: oneToThreeSentences(leadership_impact.length > 0 ? leadership_impact : leadSignals),
      business_alignment: oneToThreeSentences(business_alignment.length > 0 ? business_alignment : busSignals),
      delivery_risk: oneToThreeSentences(delivery_risk.length > 0 ? delivery_risk : riskSignals),
    },
    scores: {
      panel_weighted: weighted
        ? {
            technical: objNum(weighted, 'technical') ?? 0,
            leadership: objNum(weighted, 'leadership') ?? 0,
            execution: objNum(weighted, 'execution') ?? 0,
            culture: objNum(weighted, 'culture') ?? 0,
          }
        : undefined,
      evidence_confidence:
        sigConf &&
        (objNum(sigConf, 'scope') != null ||
          objNum(sigConf, 'execution') != null ||
          objNum(sigConf, 'leadership') != null ||
          objNum(sigConf, 'business') != null)
          ? {
              scope: objNum(sigConf, 'scope') ?? 0,
              execution: objNum(sigConf, 'execution') ?? 0,
              leadership: objNum(sigConf, 'leadership') ?? 0,
              business: objNum(sigConf, 'business') ?? 0,
            }
          : undefined,
      panel_confidence: objNum(r4, 'panel_confidence'),
    },
    anomaly_flags: anomalyDetected ? anomalyTypes : [],
    anomaly_affected_fields: anomalyDetected ? affectedFields : [],
    missing_signals,
    seniority_gap,
    rewrite_constraints,
    ...(credibility_score != null && { credibility_score }),
    ...(r9Conf?.signal_confidence && { signal_confidence: r9Conf.signal_confidence }),
    ...(evidence_traceability && { evidence_traceability }),
    ...(counterfactual && { counterfactual }),
  };
}
