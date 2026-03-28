/**
 * Enterprise audit machine layer: deterministic, version-aware, hash-anchored
 * structured audit for governance and replay. Assembled from prior stage outputs only (no LLM).
 */

export interface EnterpriseAuditMachineLayer {
  metadata: {
    audit_timestamp: string;
    pipeline_version: string;
    model_versions: Record<string, string>;
    prompt_versions: Record<string, string>;
    input_hash: string;
    structured_cv_hash?: string;
    job_description_hash?: string;
  };

  decision_snapshot: {
    final_decision?: string;
    consensus_score?: number;
    confidence?: number;
    credibility_score?: number;
    seniority_gap?: string;
    target_seniority_rationale?: string;
  };

  signals: {
    panel_scores?: Record<string, number>;
    calibrated_signals?: Record<string, number>;
    evidence_coverage_score?: number;
    template_applied?: boolean;
    template_name?: string;
    template_description?: string;
    signal_gaps?: string[];
  };

  risk_and_anomalies: {
    anomaly_detected: boolean;
    anomaly_types?: string[];
    affected_fields?: string[];
    inflation_flags?: string[];
  };

  rewrite_governance: {
    rewrite_constraints_applied?: string[];
    skill_representation_mode?: string;
    unsupported_scope_removed?: boolean;
  };

  cv_modifications: {
    sections_modified?: string[];
    ownership_language_adjusted?: boolean;
    inflation_softened?: boolean;
  };

  /** Signal confidence aggregation (Stage 9): decision_confidence, signal_stability, evidence_density, interviewer_agreement, anomaly_penalty */
  signal_confidence?: {
    decision_confidence: number;
    signal_stability: string;
    evidence_density: string;
    interviewer_agreement: number;
    anomaly_penalty: number;
  };

  /** Hash of key decision outputs for replay integrity verification. */
  output_hash?: string;
}

/**
 * Minimal signal layer shape passed into buildAuditLog for the machine layer.
 * Avoids importing PipelineRunner (getSignalLayerPayload) from auditLog.
 */
export interface BuildAuditLogSignalLayer {
  panel_scores?: Record<string, number>;
  calibrated_signals?: Record<string, number>;
  evidence_coverage_score?: number;
  evidence_template_applied?: boolean;
  template_name?: string;
  template_description?: string;
  skill_representation_mode?: string;
}

export interface BuildAuditLogOptions {
  signalLayer?: BuildAuditLogSignalLayer;
  inputPayload?: unknown;
  structuredCV?: unknown;
  jobDescription?: unknown;
  pipelineVersion?: string;
  modelVersions?: Record<string, string>;
  promptVersions?: Record<string, string>;
}
