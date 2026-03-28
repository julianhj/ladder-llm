import { buildAuditLog, getAuditLogFromResults, type AuditLog, type AuditLogStageResult } from '../src/recruitment/logic/stage_10_audit_logging/auditLog';

describe('buildAuditLog', () => {
  it('returns audit_timestamp in ISO 8601 format (flat when no options)', () => {
    const result = buildAuditLog([], null);
    expect(result).not.toHaveProperty('ui');
    expect(result).toHaveProperty('audit_timestamp');
    const ts = (result as { audit_timestamp: string }).audit_timestamp;
    expect(ts).toBeDefined();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('includes candidate_id when provided', () => {
    const result = buildAuditLog([], 'candidate-123') as AuditLog;
    expect(result.candidate_id).toBe('candidate-123');
  });

  it('omits candidate_id when null or empty', () => {
    expect((buildAuditLog([], null) as AuditLog).candidate_id).toBeUndefined();
    expect((buildAuditLog([], undefined) as AuditLog).candidate_id).toBeUndefined();
    expect((buildAuditLog([], '') as AuditLog).candidate_id).toBeUndefined();
  });

  it('extracts final_decision and consensus_score from stage_14 (consensus)', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Stage 14 - Consensus Decision',
        results: [
          {
            success: true,
            agentId: 'consensus_decision_maker',
            agentName: 'Consensus Decision Maker',
            result: { final_decision: 'hire', confidence: 85 },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.final_decision).toBe('hire');
    expect(result.consensus_score).toBe(85);
  });

  it('extracts credibility_score and rewrite_constraints from Stage 11', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_12_recruiter_reality_validator',
        stageName: 'Stage 2.5 - Recruiter Reality Validator',
        results: [
          {
            success: true,
            agentId: 'recruiter_reality_validator',
            agentName: 'Recruiter Reality Validator',
            result: {
              credibility_score: 72,
              rewrite_constraints: ['Avoid inflation', 'Emphasise scope'],
            },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.credibility_score).toBe(72);
    expect(result.rewrite_constraints).toEqual(['Avoid inflation', 'Emphasise scope']);
  });

  it('extracts seniority_gap from Stage 12', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_13_seniority_signal_enforcement',
        stageName: 'Stage 2.6 - Seniority Signal Enforcement',
        results: [
          {
            success: true,
            agentId: 'seniority_signal_enforcement',
            agentName: 'Seniority Signal Enforcement',
            result: { seniority_gap: 'candidate below target' },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.seniority_gap).toBe('candidate below target');
  });

  it('extracts cv_changes from Stage 15 merged output', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_15_final_decision',
        stageName: 'Stage 15 - Final Decision',
        results: [
          {
            success: true,
            agentId: 'merged',
            agentName: 'Merged',
            result: { changes_made: ['Added leadership bullet', 'Tightened summary'] },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.cv_changes).toEqual(['Added leadership bullet', 'Tightened summary']);
  });

  it('extracts anomaly_flags from Stage 9', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_10_anomaly_detection',
        stageName: 'Stage 2X - Anomaly Detection',
        results: [
          {
            success: true,
            agentId: 'automated_anomaly_detector',
            agentName: 'Automated Anomaly Detector',
            result: {
              anomaly_detected: true,
              anomaly_type: ['inflated_claims'],
              confidence_score: 70,
              affected_fields: ['leadership_impact'],
            },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.anomaly_flags).toEqual({
      anomaly_detected: true,
      anomaly_type: ['inflated_claims'],
      confidence_score: 70,
      affected_fields: ['leadership_impact'],
    });
  });

  it('extracts panel_scores from Stage 8', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_8_panel_weighting',
        stageName: 'Stage 2B - Panel Weighting',
        results: [
          {
            success: true,
            agentId: 'panel_weighting',
            agentName: 'Panel Weighting',
            result: {
              weighted_scores: { technical: 80, leadership: 70, execution: 75, culture: 72 },
              panel_confidence: 74,
              panel_risk_flags: [],
            },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.panel_scores).toEqual({
      technical: 80,
      leadership: 70,
      execution: 75,
      culture: 72,
    });
  });

  it('extracts signal_gaps and evidence_template_applied from Stage 5', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_6_evidence_synthesiser',
        stageName: 'Stage 2A - Evidence Synthesiser',
        results: [
          {
            success: true,
            agentId: 'evidence_synthesiser',
            agentName: 'Evidence Synthesiser',
            result: {
              evidence_template_applied: true,
              template_name: 'Manager',
              template_description: 'Team ownership, delivery through others, people management.',
              signal_gaps_against_template: ['Missing team leadership signals'],
            },
          },
        ],
      },
    ];
    const result = buildAuditLog(stages, undefined) as AuditLog;
    expect(result.evidence_template_applied).toBe(true);
    expect(result.template_name).toBe('Manager');
    expect(result.template_description).toBe('Team ownership, delivery through others, people management.');
    expect(result.signal_gaps).toEqual(['Missing team leadership signals']);
  });

  it('aggregates all stages when present (flat when no options)', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Stage 14 - Consensus Decision',
        results: [{ success: true, agentId: 'consensus_decision_maker', agentName: 'Consensus', result: { final_decision: 'maybe', confidence: 60 } }],
      },
      {
        stageId: 'stage_12_recruiter_reality_validator',
        stageName: 'Stage 12 - Recruiter Reality Validator',
        results: [{ success: true, agentId: 'recruiter_reality_validator', agentName: 'RRV', result: { credibility_score: 65, rewrite_constraints: ['X'] } }],
      },
      {
        stageId: 'stage_13_seniority_signal_enforcement',
        stageName: 'Stage 13 - Seniority Signal Enforcement',
        results: [{ success: true, agentId: 'seniority_signal_enforcement', agentName: 'SSE', result: { seniority_gap: 'aligned' } }],
      },
      {
        stageId: 'stage_15_final_decision',
        stageName: 'Stage 14 - Final Decision',
        results: [{ success: true, agentId: 'merged', agentName: 'Merged', result: { changes_made: ['Y'] } }],
      },
    ];
    const result = buildAuditLog(stages, 'test@example.com') as AuditLog;
    expect(result.audit_timestamp).toBeDefined();
    expect(result.candidate_id).toBe('test@example.com');
    expect(result.final_decision).toBe('maybe');
    expect(result.consensus_score).toBe(60);
    expect(result.credibility_score).toBe(65);
    expect(result.rewrite_constraints).toEqual(['X']);
    expect(result.seniority_gap).toBe('aligned');
    expect(result.cv_changes).toEqual(['Y']);
  });

  it('returns wrapped audit with ui and machine when options are provided', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Stage 14 - Consensus Decision',
        results: [{ success: true, agentId: 'consensus_decision_maker', agentName: 'Consensus', result: { final_decision: 'hire', confidence: 85 } }],
      },
    ];
    const result = buildAuditLog(stages, undefined, {
      inputPayload: { foo: 'bar' },
      pipelineVersion: '2.0.0',
      promptVersions: { consensus: '5.0.0', cv_optimizer: '3.5.0' },
    });
    expect(result).toHaveProperty('ui');
    expect(result).toHaveProperty('machine');
    expect(result.final_decision).toBe('hire');
    expect(result.consensus_score).toBe(85);
    const wrapped = result as import('../src/recruitment/logic/stage_10_audit_logging/auditLog').WrappedAuditLog;
    expect(wrapped.ui.audit_timestamp).toBeDefined();
    expect(wrapped.ui.final_decision).toBe('hire');
    expect(wrapped.ui.consensus_score).toBe(85);
    expect(wrapped.machine.metadata.audit_timestamp).toBeDefined();
    expect(wrapped.machine.metadata.pipeline_version).toBe('2.0.0');
    expect(wrapped.machine.metadata.input_hash).toBeDefined();
    expect(typeof wrapped.machine.metadata.input_hash).toBe('string');
    expect(wrapped.machine.decision_snapshot.final_decision).toBe('hire');
    expect(wrapped.machine.decision_snapshot.consensus_score).toBe(85);
    expect(wrapped.machine.signals).toBeDefined();
    expect(wrapped.machine.risk_and_anomalies).toBeDefined();
    expect(wrapped.machine.risk_and_anomalies.anomaly_detected).toBe(false);
    expect(wrapped.machine.rewrite_governance).toBeDefined();
    expect(wrapped.machine.cv_modifications).toBeDefined();
  });

  it('machine layer has output_hash when consensus and calibrated_signals present', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Stage 14 - Consensus Decision',
        results: [{ success: true, agentId: 'consensus_decision_maker', agentName: 'Consensus', result: { final_decision: 'hire', confidence: 80 } }],
      },
    ];
    const result = buildAuditLog(stages, undefined, {
      inputPayload: {},
      signalLayer: { calibrated_signals: { technical: 75 } },
    }) as import('../src/recruitment/logic/stage_10_audit_logging/auditLog').WrappedAuditLog;
    expect(result.machine.output_hash).toBeDefined();
    expect(typeof result.machine.output_hash).toBe('string');
  });

  it('machine metadata has structured_cv_hash and job_description_hash when provided', () => {
    const stages: AuditLogStageResult[] = [];
    const result = buildAuditLog(stages, undefined, {
      inputPayload: {},
      structuredCV: { name: 'Jane', experience: [] },
      jobDescription: { role: 'Engineer' },
    }) as import('../src/recruitment/logic/stage_10_audit_logging/auditLog').WrappedAuditLog;
    expect(result.machine.metadata.structured_cv_hash).toBeDefined();
    expect(result.machine.metadata.job_description_hash).toBeDefined();
  });
});

describe('getAuditLogFromResults', () => {
  it('returns undefined when Stage 3X is missing', () => {
    const stages: AuditLogStageResult[] = [
      { stageId: 'stage_14_consensus_decision', stageName: 'Stage 14 - Consensus Decision', results: [] },
    ];
    expect(getAuditLogFromResults(stages)).toBeUndefined();
  });

  it('returns undefined when Stage 3X has no successful Audit Logger result', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_10_audit_logging',
        stageName: 'Stage 3X - Audit Logging',
        results: [
          { success: false, agentId: 'audit_logger', agentName: 'Audit Logger', result: { audit_timestamp: 'x' } },
          { success: true, agentId: 'other', agentName: 'Other', result: {} },
        ],
      },
    ];
    expect(getAuditLogFromResults(stages)).toBeUndefined();
  });

  it('returns the Audit Logger result when Stage 3X has a successful Audit Logger result (flat)', () => {
    const audit = {
      audit_timestamp: '2026-03-02T12:00:00.000Z',
      candidate_id: 'a@b.com',
      final_decision: 'hire' as const,
    };
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_10_audit_logging',
        stageName: 'Stage 3X - Audit Logging',
        results: [
          { success: true, agentId: 'audit_logger', agentName: 'Audit Logger', result: audit },
        ],
      },
    ];
    expect(getAuditLogFromResults(stages)).toEqual(audit);
  });

  it('returns wrapped audit when Stage 3X contains WrappedAuditLog', () => {
    const stages: AuditLogStageResult[] = [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Stage 14 - Consensus Decision',
        results: [{ success: true, agentId: 'consensus_decision_maker', agentName: 'Consensus', result: { final_decision: 'hire', confidence: 90 } }],
      },
    ];
    const wrapped = buildAuditLog(stages, undefined, { inputPayload: {} });
    const stageResults: AuditLogStageResult[] = [
      {
        stageId: 'stage_10_audit_logging',
        stageName: 'Stage 3X - Audit Logging',
        results: [{ success: true, agentId: 'audit_logger', agentName: 'Audit Logger', result: wrapped }],
      },
    ];
    const got = getAuditLogFromResults(stageResults);
    expect(got).toHaveProperty('ui');
    expect(got).toHaveProperty('machine');
    expect((got as { final_decision: string }).final_decision).toBe('hire');
    expect((got as { consensus_score: number }).consensus_score).toBe(90);
  });
});
