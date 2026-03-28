/**
 * Post-optimization audit log: aggregates consensus, recruiter reality, seniority,
 * CV optimization, and optionally anomaly and panel/evidence data. No LLM; code-only.
 */

import crypto from 'crypto';
import type {
  EnterpriseAuditMachineLayer,
  BuildAuditLogOptions,
  BuildAuditLogSignalLayer,
} from '../../types/audit.js';

export interface AuditLogStageResult {
  stageId: string;
  stageName: string;
  results: Array<{ success: boolean; agentId: string; agentName: string; result?: unknown }>;
}

export interface AuditLog {
  audit_timestamp: string;
  candidate_id?: string;
  final_decision?: string;
  consensus_score?: number;
  credibility_score?: number;
  seniority_gap?: string;
  anomaly_flags?: {
    anomaly_detected: boolean;
    anomaly_type: string[];
    confidence_score: number;
    affected_fields: string[];
  };
  panel_scores?: Record<string, number>;
  rewrite_constraints?: string[];
  cv_changes?: string[];
  signal_gaps?: string[];
  evidence_template_applied?: boolean;
  template_name?: string;
  template_description?: string;
  /** Set by caller when pipeline run failed; records the error message. */
  pipeline_error?: string;
}

/**
 * Wrapped audit: UI layer (existing flat AuditLog) + machine layer + root passthrough for backward compatibility.
 */
export interface WrappedAuditLog {
  ui: AuditLog;
  machine: EnterpriseAuditMachineLayer;
  /** @deprecated Prefer audit.machine.decision_snapshot.final_decision */
  final_decision?: string;
  /** @deprecated Prefer audit.machine.decision_snapshot.consensus_score */
  consensus_score?: number;
}

export type { EnterpriseAuditMachineLayer } from '../../types/audit.js';

function hashObject(obj: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');
}

function getFirstSuccessfulResult(stage: AuditLogStageResult | undefined): unknown {
  if (!stage?.results?.length) return null;
  const r = stage.results.find((a) => a.success && a.result != null);
  return r?.result ?? null;
}

/** For Stage 3, prefer the Merged result (combined CV optimization) when present. */
function getStage3Result(stage: AuditLogStageResult | undefined): unknown {
  if (!stage?.results?.length) return null;
  const merged = stage.results.find((a) => a.success && a.result != null && a.agentId === 'merged');
  if (merged?.result != null) return merged.result;
  return getFirstSuccessfulResult(stage);
}

/**
 * Build a single audit log object from main stage results.
 * Uses ISO 8601 for audit_timestamp.
 * When options are provided, returns a wrapped audit (ui + machine layer + passthrough); otherwise returns flat AuditLog for backward compatibility with callers that do not pass options.
 */
export function buildAuditLog(
  mainStageResults: AuditLogStageResult[],
  candidateId?: string | null,
  options?: BuildAuditLogOptions
): AuditLog | WrappedAuditLog {
  const auditTimestamp = new Date().toISOString();

  const stage14Consensus = mainStageResults.find(s => s.stageId === 'stage_14_consensus_decision');
  const consensus = getFirstSuccessfulResult(stage14Consensus) as {
    final_decision?: string;
    confidence?: number;
    score?: number;
  } | null;
  const stage12RRV = mainStageResults.find(s => s.stageId === 'stage_12_recruiter_reality_validator');
  const rrv = getFirstSuccessfulResult(stage12RRV) as {
    credibility_score?: number;
    rewrite_constraints?: string[];
    inflation_flags?: string[];
    unsupported_scope_removed?: boolean;
  } | null;
  const stage13Seniority = mainStageResults.find(s => s.stageId === 'stage_13_seniority_signal_enforcement');
  const seniority = getFirstSuccessfulResult(stage13Seniority) as {
    seniority_gap?: string;
    missing_signals?: string[];
    target_seniority_rationale?: string;
  } | null;
  const stage15Final = mainStageResults.find(s => s.stageId === 'stage_15_final_decision');
  const cvOpt = getStage3Result(stage15Final) as {
    changes_made?: string[];
    sections_modified?: string[];
    ownership_language_adjusted?: boolean;
    inflation_softened?: boolean;
  } | null;
  const stage10Anomaly = mainStageResults.find(s => s.stageId === 'stage_10_anomaly_detection');
  const anomaly = getFirstSuccessfulResult(stage10Anomaly) as {
    anomaly_detected?: boolean;
    anomaly_type?: string[];
    confidence_score?: number;
    affected_fields?: string[];
  } | null;
  const stage8 = mainStageResults.find(s => s.stageId === 'stage_8_panel_weighting');
  const panel = getFirstSuccessfulResult(stage8) as { weighted_scores?: Record<string, number> } | null;
  const stage6Evidence = mainStageResults.find(s => s.stageId === 'stage_6_evidence_synthesiser');
  const evidence = getFirstSuccessfulResult(stage6Evidence) as {
    signal_gaps_against_template?: string[];
    evidence_template_applied?: boolean;
    template_name?: string;
    template_description?: string;
  } | null;
  const stage9Confidence = mainStageResults.find(s => s.stageId === 'stage_9_signal_confidence_aggregation');
  const confResult = stage9Confidence?.results.find(r => r.success)?.result as {
    signal_confidence?: EnterpriseAuditMachineLayer['signal_confidence'];
  } | undefined;

  const uiAudit: AuditLog = {
    audit_timestamp: auditTimestamp,
  };
  if (candidateId != null && candidateId !== '') {
    uiAudit.candidate_id = candidateId;
  }
  if (consensus) {
    uiAudit.final_decision = consensus.final_decision;
    uiAudit.consensus_score = consensus.confidence;
  }
  if (rrv) {
    uiAudit.credibility_score = rrv.credibility_score;
    uiAudit.rewrite_constraints = Array.isArray(rrv.rewrite_constraints) ? rrv.rewrite_constraints : undefined;
  }
  if (seniority?.seniority_gap != null) {
    uiAudit.seniority_gap = seniority.seniority_gap;
  }
  if (cvOpt && Array.isArray(cvOpt.changes_made)) {
    uiAudit.cv_changes = cvOpt.changes_made;
  }
  if (anomaly && typeof anomaly.anomaly_detected === 'boolean') {
    uiAudit.anomaly_flags = {
      anomaly_detected: anomaly.anomaly_detected,
      anomaly_type: Array.isArray(anomaly.anomaly_type) ? anomaly.anomaly_type : [],
      confidence_score: typeof anomaly.confidence_score === 'number' ? anomaly.confidence_score : 0,
      affected_fields: Array.isArray(anomaly.affected_fields) ? anomaly.affected_fields : [],
    };
  }
  if (panel?.weighted_scores && typeof panel.weighted_scores === 'object') {
    uiAudit.panel_scores = panel.weighted_scores;
  }
  if (evidence) {
    if (Array.isArray(evidence.signal_gaps_against_template)) {
      uiAudit.signal_gaps = evidence.signal_gaps_against_template;
    }
    if (typeof evidence.evidence_template_applied === 'boolean') {
      uiAudit.evidence_template_applied = evidence.evidence_template_applied;
    }
    if (evidence.template_name != null) {
      uiAudit.template_name = evidence.template_name;
    }
    if (evidence.template_description != null) {
      uiAudit.template_description = evidence.template_description;
    }
  }

  if (options == null) {
    return uiAudit;
  }

  const signalLayer: BuildAuditLogSignalLayer | undefined = options.signalLayer;
  const pipelineVersion = options.pipelineVersion ?? process.env.PIPELINE_VERSION ?? 'unknown';
  const modelVersions = options.modelVersions ?? {
    consensus: process.env.CONSENSUS_MODEL ?? 'unknown',
    cv_optimizer: process.env.CV_MODEL ?? 'unknown',
  };
  const promptVersions = options.promptVersions ?? {
    consensus: '5.0.0',
    cv_optimizer: '3.5.0',
  };
  const inputPayload = options.inputPayload ?? {};
  const inputHash = hashObject(inputPayload);
  const structuredCV = options.structuredCV;
  const jobDescription = options.jobDescription;

  const consensusScore = consensus != null ? (consensus.score ?? consensus.confidence) : undefined;

  const machineAudit: EnterpriseAuditMachineLayer = {
    metadata: {
      audit_timestamp: auditTimestamp,
      pipeline_version: pipelineVersion,
      model_versions: modelVersions,
      prompt_versions: promptVersions,
      input_hash: inputHash,
      structured_cv_hash: structuredCV !== undefined ? hashObject(structuredCV) : undefined,
      job_description_hash: jobDescription !== undefined ? hashObject(jobDescription) : undefined,
    },
    decision_snapshot: {
      final_decision: consensus?.final_decision,
      consensus_score: consensusScore,
      confidence: consensus?.confidence,
      credibility_score: rrv?.credibility_score,
      seniority_gap: seniority?.seniority_gap,
      target_seniority_rationale: seniority?.target_seniority_rationale,
    },
    signals: {
      panel_scores: panel?.weighted_scores ?? signalLayer?.panel_scores,
      calibrated_signals: signalLayer?.calibrated_signals,
      evidence_coverage_score: signalLayer?.evidence_coverage_score,
      template_applied: signalLayer?.evidence_template_applied ?? evidence?.evidence_template_applied,
      template_name: signalLayer?.template_name ?? evidence?.template_name,
      template_description: signalLayer?.template_description ?? evidence?.template_description,
      signal_gaps: seniority?.missing_signals ?? uiAudit.signal_gaps,
    },
    risk_and_anomalies: {
      anomaly_detected: anomaly?.anomaly_detected ?? false,
      anomaly_types: anomaly?.anomaly_type,
      affected_fields: anomaly?.affected_fields,
      inflation_flags: rrv?.inflation_flags,
    },
    rewrite_governance: {
      rewrite_constraints_applied: rrv?.rewrite_constraints,
      skill_representation_mode: signalLayer?.skill_representation_mode,
      unsupported_scope_removed: rrv?.unsupported_scope_removed,
    },
    cv_modifications: {
      sections_modified: cvOpt?.sections_modified,
      ownership_language_adjusted: cvOpt?.ownership_language_adjusted,
      inflation_softened: cvOpt?.inflation_softened,
    },
    ...(confResult?.signal_confidence && { signal_confidence: confResult.signal_confidence }),
  };

  if (consensus?.final_decision != null && (consensusScore !== undefined || signalLayer?.calibrated_signals != null)) {
    machineAudit.output_hash = hashObject({
      final_decision: consensus.final_decision,
      score: consensusScore,
      calibrated_signals: signalLayer?.calibrated_signals,
    });
  }

  const audit: WrappedAuditLog = {
    ui: uiAudit,
    machine: machineAudit,
  };
  if (consensus?.final_decision != null) {
    audit.final_decision = consensus.final_decision;
  }
  if (consensusScore !== undefined) {
    audit.consensus_score = consensusScore;
  }
  return audit;
}

/**
 * Extract the audit log from pipeline stage results (Stage 10 - Audit Logging).
 * Returns undefined if the stage or Audit Logger result is missing.
 * When pipeline runs with options, result is WrappedAuditLog; legacy logs may be flat AuditLog.
 */
export function getAuditLogFromResults(
  stageResults: AuditLogStageResult[]
): WrappedAuditLog | AuditLog | undefined {
  const stage10 = stageResults.find((s) => s.stageId === 'stage_10_audit_logging');
  if (!stage10?.results?.length) return undefined;
  const auditResult = stage10.results.find(
    (r) => r.success && r.agentId === 'audit_logger' && r.result != null
  );
  return auditResult?.result as WrappedAuditLog | AuditLog | undefined;
}
