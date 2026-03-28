/** Stage ids that run in the pipeline but are not exposed to the frontend (no new visible steps). */
export const BACKEND_ONLY_STAGE_IDS = new Set([
  'stage_4_signal_normalisation',
  'stage_5_interview_calibration',
  'stage_6_evidence_synthesiser',
  'stage_8_panel_weighting',
  'stage_9_signal_confidence_aggregation',
  'stage_10_anomaly_detection',
  'stage_12_recruiter_reality_validator',
  'stage_13_seniority_signal_enforcement',
  'stage_10_audit_logging',
]);

/** Returns stages that should be displayed to the frontend (excludes backend-only stages). */
export function getDisplayStages<T extends { stageId: string }>(stages: T[]): T[] {
  return stages.filter(s => !BACKEND_ONLY_STAGE_IDS.has(s.stageId));
}
