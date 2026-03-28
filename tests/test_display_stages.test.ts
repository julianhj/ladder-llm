import { getDisplayStages, BACKEND_ONLY_STAGE_IDS } from '../src/recruitment/displayStages';

describe('Display stages filter (pipeline v2.3)', () => {
  it('excludes backend-only stages (4-12, audit) from display stages', () => {
    const stages = [
      { stageId: 'stage_0_career_trajectory', stageName: 'Stage 0 - Career Trajectory', agents: [] },
      { stageId: 'stage_2_role_success_model', stageName: 'Stage 2 - Role Success Model', agents: [] },
      { stageId: 'stage_3_interviews', stageName: 'Stage 3 - Interviews', agents: [] },
      { stageId: 'stage_4_signal_normalisation', stageName: 'Stage 4 - Signal Normalisation', agents: [] },
      { stageId: 'stage_5_interview_calibration', stageName: 'Stage 5 - Interview Calibration', agents: [] },
      { stageId: 'stage_6_evidence_synthesiser', stageName: 'Stage 6 - Evidence Synthesiser', agents: [] },
      { stageId: 'stage_7_evidence_traceability', stageName: 'Stage 7 - Evidence Traceability', agents: [] },
      { stageId: 'stage_8_panel_weighting', stageName: 'Stage 8 - Panel Weighting', agents: [] },
      { stageId: 'stage_9_signal_confidence_aggregation', stageName: 'Stage 9 - Signal Confidence Aggregation', agents: [] },
      { stageId: 'stage_10_anomaly_detection', stageName: 'Stage 10 - Anomaly Detection', agents: [] },
      { stageId: 'stage_11_counterfactual_challenge', stageName: 'Stage 11 - Counterfactual Challenge', agents: [] },
      { stageId: 'stage_12_recruiter_reality_validator', stageName: 'Stage 12 - Recruiter Reality Validator', agents: [] },
      { stageId: 'stage_13_seniority_signal_enforcement', stageName: 'Stage 13 - Seniority Signal Enforcement', agents: [] },
      { stageId: 'stage_14_consensus_decision', stageName: 'Stage 14 - Consensus Decision', agents: [] },
      { stageId: 'stage_15_final_decision', stageName: 'Stage 15 - Final Decision', agents: [] },
      { stageId: 'stage_10_audit_logging', stageName: 'Stage 10 - Audit Logging', agents: [] },
    ];
    const display = getDisplayStages(stages);
    expect(display).toHaveLength(7);
    expect(display.map(s => (s as { stageName: string }).stageName)).toEqual([
      'Stage 0 - Career Trajectory',
      'Stage 2 - Role Success Model',
      'Stage 3 - Interviews',
      'Stage 7 - Evidence Traceability',
      'Stage 11 - Counterfactual Challenge',
      'Stage 14 - Consensus Decision',
      'Stage 15 - Final Decision',
    ]);
    expect(display.some(s => BACKEND_ONLY_STAGE_IDS.has(s.stageId))).toBe(false);
  });

  it('includes Stage 9 (signal confidence), Stage 10 (anomaly) and stage_10_audit_logging in BACKEND_ONLY_STAGE_IDS so they are hidden from frontend', () => {
    expect(BACKEND_ONLY_STAGE_IDS.has('stage_9_signal_confidence_aggregation')).toBe(true);
    expect(BACKEND_ONLY_STAGE_IDS.has('stage_10_anomaly_detection')).toBe(true);
    expect(BACKEND_ONLY_STAGE_IDS.has('stage_10_audit_logging')).toBe(true);
  });

  it('returns all stages when none are backend-only', () => {
    const stages = [
      { stageId: 'stage_3_interviews', stageName: 'Stage 3 - Interviews', agents: [] },
      { stageId: 'stage_2_analysis', stageName: 'Stage 2 - Analysis', agents: [] },
    ];
    expect(getDisplayStages(stages)).toHaveLength(2);
  });
});
