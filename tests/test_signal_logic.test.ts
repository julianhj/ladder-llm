import {
  buildSignalGraph,
  type SignalGraph,
  type StageResultInput,
} from '../src/recruitment/logic/signal_layer/signalGraph';
import {
  computeScore,
  computeScoreAndDecision,
  scoreToFinalDecision,
} from '../src/recruitment/logic/signal_layer/scoreCandidate';
import { inferSeniority } from '../src/recruitment/logic/signal_layer/inferSeniority';
import { computeConfidence, computeConfidenceScores } from '../src/recruitment/logic/signal_layer/confidence';
import { getSignalLayerPayload } from '../src/recruitment/pipeline/PipelineRunner';
import type { StageResult } from '../src/recruitment/pipeline/PipelineRunner';
import { buildEvidence } from '../src/recruitment/logic/signal_layer/buildEvidence';
import { countSignals, countSignalsWithEvidence, computeEvidenceCoverage } from '../src/recruitment/logic/signal_layer/evidenceCoverage';
import { calibrateSignals, inferSkillRepresentationMode } from '../src/recruitment/logic/signal_layer/signalCalibration';

describe('signalGraph', () => {
  it('builds graph from stage_8_panel_weighting only when panel weighting has result', () => {
    const panelWeightingResults: StageResultInput[] = [
      {
        result: {
          weighted_scores: { technical: 70, leadership: 60, execution: 80, culture: 75 },
          panel_confidence: 72,
          panel_risk_flags: [],
        },
      },
    ];
    const graph = buildSignalGraph([], [], [], panelWeightingResults);
    expect(graph.execution.delivery_consistency).toBe(80);
    expect(graph.execution.execution_maturity).toBe(80);
    expect(graph.execution.technical).toBe(70);
    expect(graph.leadership.leadership).toBe(60);
    expect(graph.business.culture).toBe(75);
    expect(graph.risk.delivery_risk).toBeDefined();
  });

  it('merges stage_6_evidence_synthesiser signal_confidence into graph', () => {
    const panelWeightingResults: StageResultInput[] = [
      {
        result: {
          weighted_scores: { technical: 50, leadership: 50, execution: 50, culture: 50 },
          panel_confidence: 50,
          panel_risk_flags: [],
        },
      },
    ];
    const evidenceSynthesiserResults: StageResultInput[] = [
      {
        result: {
          scope_signals: [],
          execution_signals: [],
          leadership_signals: [],
          business_signals: [],
          risk_signals: [],
          signal_confidence: { scope: 90, execution: 85, leadership: 88, business: 82 },
        },
      },
    ];
    const graph = buildSignalGraph([], [], evidenceSynthesiserResults, panelWeightingResults);
    expect(graph.seniority.scope_level).toBe(90);
    expect(graph.business.business_alignment).toBe(82);
  });

  it('returns null-like defaults when no panel weighting results', () => {
    const graph = buildSignalGraph([], [], [], []);
    expect(graph.execution.delivery_consistency).toBe(0);
    expect(graph.leadership.scope_level).toBe(0);
  });
});

describe('scoreCandidate', () => {
  const makeGraph = (): SignalGraph => ({
    execution: { delivery_consistency: 70, execution_maturity: 70, technical: 70 },
    leadership: { scope_level: 65, leadership_strength: 65, leadership: 65 },
    business: { business_alignment: 60, culture: 60 },
    seniority: { scope_level: 50, team_scope: 50, ownership_scope: 50, delivery_complexity: 50, stakeholder_complexity: 50 },
    risk: { delivery_risk: 20, panel_risk_score: 80 },
    confidence: {},
    evidence: [],
  });

  it('computeScore returns number 0-100', () => {
    const graph = makeGraph();
    const score = computeScore(graph);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scoreToFinalDecision: 0-59 declined, 60-79 maybe, 80-100 hire', () => {
    expect(scoreToFinalDecision(50)).toBe('declined');
    expect(scoreToFinalDecision(59)).toBe('declined');
    expect(scoreToFinalDecision(60)).toBe('maybe');
    expect(scoreToFinalDecision(79)).toBe('maybe');
    expect(scoreToFinalDecision(80)).toBe('hire');
    expect(scoreToFinalDecision(100)).toBe('hire');
  });

  it('computeScoreAndDecision returns computed_score and final_decision', () => {
    const graph = makeGraph();
    const { computed_score, final_decision } = computeScoreAndDecision(graph);
    expect(computed_score).toBeGreaterThanOrEqual(0);
    expect(computed_score).toBeLessThanOrEqual(100);
    expect(['hire', 'maybe', 'declined']).toContain(final_decision);
  });
});

describe('inferSeniority', () => {
  it('returns director when scope_level > 80', () => {
    const graph: SignalGraph = {
      execution: {},
      leadership: { scope_level: 85, leadership_strength: 85, leadership: 85 },
      business: {},
      seniority: { scope_level: 85, team_scope: 0, ownership_scope: 0, delivery_complexity: 0, stakeholder_complexity: 0 },
      risk: {},
      confidence: {},
      evidence: [],
    };
    expect(inferSeniority(graph)).toBe('director');
  });

  it('returns head_of when scope_level > 65 and <= 80', () => {
    const graph: SignalGraph = {
      execution: {},
      leadership: { scope_level: 70, leadership_strength: 70, leadership: 70 },
      business: {},
      seniority: {},
      risk: {},
      confidence: {},
      evidence: [],
    };
    expect(inferSeniority(graph)).toBe('head_of');
  });

  it('returns manager when scope_level > 50 and <= 65', () => {
    const graph: SignalGraph = {
      execution: {},
      leadership: { scope_level: 55, leadership_strength: 55, leadership: 55 },
      business: {},
      seniority: {},
      risk: {},
      confidence: {},
      evidence: [],
    };
    expect(inferSeniority(graph)).toBe('manager');
  });

  it('returns senior_ic when scope_level <= 50', () => {
    const graph: SignalGraph = {
      execution: {},
      leadership: { scope_level: 40, leadership_strength: 40, leadership: 40 },
      business: {},
      seniority: {},
      risk: {},
      confidence: {},
      evidence: [],
    };
    expect(inferSeniority(graph)).toBe('senior_ic');
  });
});

describe('confidence', () => {
  it('computeConfidence returns 0-100', () => {
    const graph: SignalGraph = {
      execution: { delivery_consistency: 70, execution_maturity: 70, technical: 70 },
      leadership: { scope_level: 65, leadership_strength: 65, leadership: 65 },
      business: { business_alignment: 60, culture: 60 },
      seniority: { scope_level: 50, team_scope: 50, ownership_scope: 50, delivery_complexity: 50, stakeholder_complexity: 50 },
      risk: { delivery_risk: 20, panel_risk_score: 80 },
      confidence: {},
      evidence: [],
    };
    const c = computeConfidence(graph);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(100);
  });

  it('computeConfidenceScores returns record with overall', () => {
    const graph: SignalGraph = {
      execution: { delivery_consistency: 70, execution_maturity: 70, technical: 70 },
      leadership: { scope_level: 65, leadership_strength: 65, leadership: 65 },
      business: { business_alignment: 60, culture: 60 },
      seniority: { scope_level: 50, team_scope: 50, ownership_scope: 50, delivery_complexity: 50, stakeholder_complexity: 50 },
      risk: { delivery_risk: 20, panel_risk_score: 80 },
      confidence: {},
      evidence: [],
    };
    const scores = computeConfidenceScores(graph);
    expect(scores.overall).toBeDefined();
    expect(typeof scores.overall).toBe('number');
  });
});

describe('buildEvidence', () => {
  it('returns empty array when both inputs null', () => {
    expect(buildEvidence(null, null)).toEqual([]);
  });

  it('returns evidence items when CV has matching keywords', () => {
    const cv = {
      summary_keywords: ['leadership', 'delivery', 'team'],
      skills: ['technical', 'architecture'],
      experience: [{ role: 'Lead Engineer', company: 'Acme', tags: ['delivery', 'governance'] }],
    };
    const items = buildEvidence(cv as any, null);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(0);
    items.forEach(item => {
      expect(item).toHaveProperty('signal_key');
      expect(item).toHaveProperty('source_type', 'cv');
      expect(item).toHaveProperty('source_section');
      expect(item).toHaveProperty('excerpt');
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(100);
    });
  });
});

describe('evidenceCoverage', () => {
  it('countSignals returns 0 for empty graph', () => {
    const graph: SignalGraph = { execution: {}, leadership: {}, business: {}, seniority: {}, risk: {}, confidence: {}, evidence: [] };
    expect(countSignals(graph)).toBe(0);
  });

  it('computeEvidenceCoverage returns 0 when total signals 0', () => {
    const graph: SignalGraph = { execution: {}, leadership: {}, business: {}, seniority: {}, risk: {}, confidence: {}, evidence: [] };
    expect(computeEvidenceCoverage(graph)).toBe(0);
  });

  it('computeEvidenceCoverage returns 0-100 when graph has signals', () => {
    const graph: SignalGraph = {
      execution: { delivery_consistency: 70, execution_maturity: 70 },
      leadership: { scope_level: 65 },
      business: {},
      seniority: {},
      risk: {},
      confidence: {},
      evidence: [
        { signal_key: 'execution.delivery_consistency', source_type: 'cv', source_section: 'experience', excerpt: 'Led delivery', confidence: 80 },
      ],
    };
    const coverage = computeEvidenceCoverage(graph);
    expect(coverage).toBeGreaterThanOrEqual(0);
    expect(coverage).toBeLessThanOrEqual(100);
    expect(countSignalsWithEvidence(graph)).toBeGreaterThanOrEqual(1);
  });
});

describe('signalCalibration', () => {
  it('returns CalibratedSignalGraph with calibrated_scores 0-100', () => {
    const graph: SignalGraph = {
      execution: { delivery_consistency: 70, execution_maturity: 70, technical: 70 },
      leadership: { scope_level: 65, leadership_strength: 65, leadership: 65 },
      business: { business_alignment: 60, culture: 60 },
      seniority: { scope_level: 50, team_scope: 50, ownership_scope: 50, delivery_complexity: 50, stakeholder_complexity: 50 },
      risk: { delivery_risk: 20, panel_risk_score: 80 },
      confidence: {},
      evidence: [],
    };
    const calibrated = calibrateSignals(graph, 50);
    expect(calibrated.calibrated_scores).toBeDefined();
    expect(typeof calibrated.calibrated_scores).toBe('object');
    for (const v of Object.values(calibrated.calibrated_scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('returns overall 0 when graph has no numeric signals', () => {
    const graph: SignalGraph = { execution: {}, leadership: {}, business: {}, seniority: {}, risk: {}, confidence: {}, evidence: [] };
    const calibrated = calibrateSignals(graph, 0);
    expect(calibrated.calibrated_scores.overall).toBe(0);
  });
});

describe('getSignalLayerPayload (Runner integration)', () => {
  it('returns payload when Stage 8 has successful result', () => {
    const mainStageResults: StageResult[] = [
      { stageId: 'stage_3_interviews', stageName: 'Stage 3 - Interviews', results: [] },
      { stageId: 'stage_4_signal_normalisation', stageName: 'Stage 4 - Signal Normalisation', results: [] },
      {
        stageId: 'stage_6_evidence_synthesiser',
        stageName: 'Stage 6 - Evidence Synthesiser',
        results: [{ success: true, agentId: 'evidence_synthesiser', agentName: 'Evidence', result: { signal_confidence: { scope: 60, execution: 70, leadership: 65, business: 60 }, scope_signals: [], execution_signals: [], leadership_signals: [], business_signals: [], risk_signals: [] } }],
      },
      {
        stageId: 'stage_8_panel_weighting',
        stageName: 'Stage 8 - Panel Weighting',
        results: [
          {
            success: true,
            agentId: 'panel_weighting',
            agentName: 'Panel',
            result: {
              weighted_scores: { technical: 70, leadership: 72, execution: 75, culture: 68 },
              panel_confidence: 71,
              panel_risk_flags: [],
            },
          },
        ],
      },
    ];
    const payload = getSignalLayerPayload(mainStageResults);
    expect(payload).not.toBeNull();
    expect(payload!.signal_graph).toBeDefined();
    expect(payload!.computed_score).toBeGreaterThanOrEqual(0);
    expect(payload!.computed_score).toBeLessThanOrEqual(100);
    expect(['hire', 'maybe', 'declined']).toContain(payload!.final_decision);
    expect(payload!.inferred_seniority).toBeDefined();
    expect(payload!.confidence_scores).toBeDefined();
    expect(Array.isArray(payload!.evidence_items)).toBe(true);
    expect(typeof payload!.evidence_coverage_score).toBe('number');
    expect(payload!.evidence_coverage_score).toBeGreaterThanOrEqual(0);
    expect(payload!.evidence_coverage_score).toBeLessThanOrEqual(100);
    expect(payload!.calibrated_signals).toBeDefined();
    expect(typeof payload!.calibrated_signals).toBe('object');
  });

  it('returns null when Stage 8 has no successful results', () => {
    const mainStageResults: StageResult[] = [
      { stageId: 'stage_8_panel_weighting', stageName: 'Stage 8 - Panel Weighting', results: [{ success: false, agentId: 'panel_weighting', agentName: 'Panel' }] },
    ];
    expect(getSignalLayerPayload(mainStageResults)).toBeNull();
  });

  it('returns skill_representation_mode from Stage 12 LLM output when present', () => {
    const baseStages: StageResult[] = [
      { stageId: 'stage_3_interviews', stageName: 'Stage 3 - Interviews', results: [] },
      { stageId: 'stage_4_signal_normalisation', stageName: 'Stage 4 - Signal Normalisation', results: [] },
      {
        stageId: 'stage_6_evidence_synthesiser',
        stageName: 'Stage 6 - Evidence Synthesiser',
        results: [{ success: true, agentId: 'evidence_synthesiser', agentName: 'Evidence', result: { signal_confidence: { scope: 60, execution: 70, leadership: 65, business: 60 }, scope_signals: [], execution_signals: [], leadership_signals: [], business_signals: [], risk_signals: [] } }],
      },
      {
        stageId: 'stage_8_panel_weighting',
        stageName: 'Stage 8 - Panel Weighting',
        results: [{ success: true, agentId: 'panel_weighting', agentName: 'Panel', result: { weighted_scores: { technical: 70, leadership: 72, execution: 75, culture: 68 }, panel_confidence: 71, panel_risk_flags: [] } }],
      },
    ];
    const stage13Narrative = {
      stageId: 'stage_13_seniority_signal_enforcement',
      stageName: 'Stage 13',
      results: [{
        success: true,
        agentId: 'seniority_signal_enforcement',
        agentName: 'SSE',
        result: {
          target_seniority_class: 'head',
          target_seniority_level: 'Director-level scope',
          skill_representation_mode: 'narrative',
          experience_format: 'hybrid',
        },
      }],
    };
    const stage13Keywords = {
      stageId: 'stage_13_seniority_signal_enforcement',
      stageName: 'Stage 13',
      results: [{
        success: true,
        agentId: 'seniority_signal_enforcement',
        agentName: 'SSE',
        result: {
          target_seniority_class: 'intermediate',
          target_seniority_level: 'Sr Manager',
          skill_representation_mode: 'keywords',
          experience_format: 'bullets',
        },
      }],
    };

    expect(getSignalLayerPayload([...baseStages, stage13Narrative], null)!.skill_representation_mode).toBe('narrative');
    expect(getSignalLayerPayload([...baseStages, stage13Keywords], null)!.skill_representation_mode).toBe('keywords');
  });

  it('returns skill_representation_mode keywords when Stage 12 absent or has no skill_representation_mode', () => {
    const baseStages: StageResult[] = [
      { stageId: 'stage_3_interviews', stageName: 'Stage 3 - Interviews', results: [] },
      { stageId: 'stage_4_signal_normalisation', stageName: 'Stage 4 - Signal Normalisation', results: [] },
      {
        stageId: 'stage_6_evidence_synthesiser',
        stageName: 'Stage 6 - Evidence Synthesiser',
        results: [{ success: true, agentId: 'evidence_synthesiser', agentName: 'Evidence', result: { signal_confidence: { scope: 60, execution: 70, leadership: 65, business: 60 }, scope_signals: [], execution_signals: [], leadership_signals: [], business_signals: [], risk_signals: [] } }],
      },
      {
        stageId: 'stage_8_panel_weighting',
        stageName: 'Stage 8 - Panel Weighting',
        results: [{ success: true, agentId: 'panel_weighting', agentName: 'Panel', result: { weighted_scores: { technical: 70, leadership: 72, execution: 75, culture: 68 }, panel_confidence: 71, panel_risk_flags: [] } }],
      },
    ];
    expect(getSignalLayerPayload(baseStages, null)!.skill_representation_mode).toBe('keywords');
  });
});

describe('inferSkillRepresentationMode', () => {
  it('returns mode from llmSkillRepresentationMode when provided by Stage 7', () => {
    expect(inferSkillRepresentationMode({ llmSkillRepresentationMode: 'narrative' })).toBe('narrative');
    expect(inferSkillRepresentationMode({ llmSkillRepresentationMode: 'keywords' })).toBe('keywords');
  });

  it('returns keywords when llmSkillRepresentationMode not provided (Stage 7 absent or failed)', () => {
    expect(inferSkillRepresentationMode({})).toBe('keywords');
    expect(inferSkillRepresentationMode({ llmSkillRepresentationMode: undefined })).toBe('keywords');
  });
});
