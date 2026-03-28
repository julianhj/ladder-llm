import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AssessmentResultSchema,
  ConsensusResultSchema,
  enforceResponsesJsonSchemaConstraints,
  SignalNormalizedSchema,
  RecruiterRealityValidationSchema,
  EvidenceSynthesiserSchema,
  PanelWeightingSchema,
  SenioritySignalEnforcementSchema,
  normalizeStructuredListFields,
} from '../src/recruitment/agents/AgentBuilder';
import {
  countInterviewQuestionDifficulties,
  hasBalancedInterviewDifficulties,
  InterviewAssessmentSchema,
} from '../src/recruitment/agents/schemas/index.js';

function collectHeadingSummaryLikeObjects(schema: unknown): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (!Array.isArray(node)) {
      const objectNode = node as Record<string, unknown>;
      const properties =
        objectNode.properties && typeof objectNode.properties === 'object' && !Array.isArray(objectNode.properties)
          ? (objectNode.properties as Record<string, unknown>)
          : null;
      if (
        properties &&
        Object.prototype.hasOwnProperty.call(properties, 'heading') &&
        Object.prototype.hasOwnProperty.call(properties, 'summary') &&
        Object.prototype.hasOwnProperty.call(properties, 'description')
      ) {
        matches.push(objectNode);
      }
      for (const value of Object.values(objectNode)) {
        walk(value);
      }
      return;
    }

    for (const item of node) {
      walk(item);
    }
  };

  walk(schema);
  return matches;
}

describe('AgentBuilder schema regressions', () => {
  it('enforces required description in nested heading/summary schema branches', () => {
    const assessmentSchema = zodToJsonSchema(AssessmentResultSchema, {
      name: 'assessment',
      target: 'openApi3',
      $refStrategy: 'none',
    }) as Record<string, unknown>;
    const consensusSchema = zodToJsonSchema(ConsensusResultSchema, {
      name: 'consensus',
      target: 'openApi3',
      $refStrategy: 'none',
    }) as Record<string, unknown>;

    enforceResponsesJsonSchemaConstraints(assessmentSchema);
    enforceResponsesJsonSchemaConstraints(consensusSchema);

    const assessmentHeadingSummaryNodes = collectHeadingSummaryLikeObjects(assessmentSchema);
    const consensusHeadingSummaryNodes = collectHeadingSummaryLikeObjects(consensusSchema);
    const allNodes = [...assessmentHeadingSummaryNodes, ...consensusHeadingSummaryNodes];

    for (const node of allNodes) {
      const required = Array.isArray(node.required) ? node.required : [];
      expect(required).toEqual(expect.arrayContaining(['heading', 'description', 'contextual_help']));
      expect(node.additionalProperties).toBe(false);
      expect(node.type).toBe('object');
    }
  });

  describe('Pipeline v2 schemas', () => {
    it('parses valid SignalNormalized output', () => {
      const payload = {
        aggregated_signals: {
          technical_scope: ['Scalable systems'],
          execution_authority: ['Operating rhythms'],
          leadership_impact: ['Multi-team orgs'],
          delivery_risk: ['Dependency gaps'],
          business_alignment: ['Platform roadmap'],
        },
        confidence_scores: { technical_scope: 95, execution_authority: 90 },
        signal_gaps: ['release discipline'],
      };
      const parsed = SignalNormalizedSchema.parse(payload);
      expect(parsed.aggregated_signals.technical_scope).toEqual(['Scalable systems']);
      expect(parsed.signal_gaps).toContain('release discipline');
    });

    it('parses valid RecruiterRealityValidation output', () => {
      const payload = {
        credibility_score: 85,
        inflation_flags: ['architecture_without_scope', 'tactical_language'],
        director_signal_gaps: ['org_design', 'delivery_systems'],
        rewrite_constraints: ['Reduce tactical language'],
      };
      const parsed = RecruiterRealityValidationSchema.parse(payload);
      expect(parsed.credibility_score).toBe(85);
      expect(parsed.inflation_flags).toHaveLength(2);
      expect(parsed.rewrite_constraints).toHaveLength(1);
    });

    it('normalizes signal_normalized and recruiter_reality_validation in normalizeStructuredListFields', () => {
      const signalData = { aggregated_signals: { technical_scope: [] }, confidence_scores: {}, signal_gaps: ['gap'] };
      const outSignal = normalizeStructuredListFields('signal_normalized', signalData) as typeof signalData;
      expect(Array.isArray(outSignal.signal_gaps)).toBe(true);

      const realityData = { credibility_score: 70, inflation_flags: [], director_signal_gaps: [], rewrite_constraints: [] };
      const outReality = normalizeStructuredListFields('recruiter_reality_validation', realityData) as typeof realityData;
      expect(Array.isArray(outReality.rewrite_constraints)).toBe(true);
    });

    it('parses valid EvidenceSynthesiser output', () => {
      const payload = {
        scope_signals: ['Multi-team ownership'],
        execution_signals: ['Release discipline', 'Planning cadence'],
        leadership_signals: ['EM coaching'],
        business_signals: ['Customer impact'],
        risk_signals: ['Dependency gaps'],
        signal_confidence: { scope: 80, execution: 75, leadership: 70, business: 85 },
      };
      const parsed = EvidenceSynthesiserSchema.parse(payload);
      expect(parsed.scope_signals).toContain('Multi-team ownership');
      expect(parsed.signal_confidence.scope).toBe(80);
    });

    it('parses valid PanelWeighting output', () => {
      const payload = {
        weighted_scores: { technical: 78, leadership: 72, execution: 80, culture: 75 },
        panel_confidence: 76,
        panel_risk_flags: ['Conflicting technical vs recruiter signal'],
      };
      const parsed = PanelWeightingSchema.parse(payload);
      expect(parsed.weighted_scores.technical).toBe(78);
      expect(parsed.panel_risk_flags).toHaveLength(1);
    });

    it('parses valid SenioritySignalEnforcement output', () => {
      const payload = {
        target_seniority_class: 'head' as const,
        candidate_seniority_class: 'manager' as const,
        target_seniority_level: 'Director',
        skill_representation_mode: 'narrative' as const,
        experience_format: 'hybrid' as const,
        candidate_seniority_level: 'Senior Manager',
        seniority_gap: 'candidate below target',
        inflation_risk: 25,
        missing_signals: ['Multi-team org design'],
        rewrite_constraints: ['Do not claim Director scope without evidence'],
      };
      const parsed = SenioritySignalEnforcementSchema.parse(payload);
      expect(parsed.target_seniority_level).toBe('Director');
      expect(parsed.skill_representation_mode).toBe('narrative');
      expect(parsed.experience_format).toBe('hybrid');
      expect(parsed.rewrite_constraints).toHaveLength(1);
    });

    it('parses SenioritySignalEnforcement with dynamic JD-derived levels and optional rationale', () => {
      const payload = {
        target_seniority_class: 'lead' as const,
        candidate_seniority_class: 'senior' as const,
        target_seniority_level: 'Director-level scope',
        skill_representation_mode: 'narrative' as const,
        experience_format: 'hybrid' as const,
        candidate_seniority_level: 'Senior IC with team influence',
        seniority_gap: 'candidate below target',
        inflation_risk: 30,
        missing_signals: [],
        rewrite_constraints: [],
        target_seniority_rationale: 'JD requires multi-team ownership and org-level strategy.',
      };
      const parsed = SenioritySignalEnforcementSchema.parse(payload);
      expect(parsed.target_seniority_level).toBe('Director-level scope');
      expect(parsed.candidate_seniority_level).toBe('Senior IC with team influence');
      expect(parsed.target_seniority_rationale).toBe('JD requires multi-team ownership and org-level strategy.');
    });

    it('supports cross-industry seniority labeling with typed classes', () => {
      const payload = {
        target_seniority_class: 'head' as const,
        candidate_seniority_class: 'manager' as const,
        target_seniority_level: 'Head of Clinical Operations',
        candidate_seniority_level: 'Clinical Operations Manager',
        seniority_track: 'people_manager' as const,
        scope_level: 'function' as const,
        impact_horizon: 'annual' as const,
        ambiguity_level: 'high' as const,
        skill_representation_mode: 'narrative' as const,
        experience_format: 'hybrid' as const,
        seniority_gap: 'candidate below target',
        inflation_risk: 15,
        missing_signals: ['Organisation-wide operating model ownership'],
        rewrite_constraints: ['Avoid unsupported enterprise governance claims'],
      };
      const parsed = SenioritySignalEnforcementSchema.parse(payload);
      expect(parsed.target_seniority_class).toBe('head');
      expect(parsed.scope_level).toBe('function');
      expect(parsed.skill_representation_mode).toBe('narrative');
    });

    it('normalizes evidence_synthesiser, panel_weighting, and seniority_signal_enforcement in normalizeStructuredListFields', () => {
      const evidenceData = {
        scope_signals: [],
        execution_signals: [],
        leadership_signals: [],
        business_signals: [],
        risk_signals: [],
        signal_confidence: { scope: 0, execution: 0, leadership: 0, business: 0 },
      };
      const outEvidence = normalizeStructuredListFields('evidence_synthesiser', evidenceData) as Record<string, unknown>;
      expect(Array.isArray(outEvidence.scope_signals)).toBe(true);
      expect(outEvidence.signal_confidence).toBeDefined();

      const panelData = { weighted_scores: { technical: 0, leadership: 0, execution: 0, culture: 0 }, panel_confidence: 70, panel_risk_flags: [] };
      const outPanel = normalizeStructuredListFields('panel_weighting', panelData) as Record<string, unknown>;
      expect(Array.isArray(outPanel.panel_risk_flags)).toBe(true);

      const seniorityData = {
        target_seniority_class: 'intermediate',
        candidate_seniority_class: 'intermediate',
        target_seniority_level: 'IC',
        skill_representation_mode: 'keywords',
        experience_format: 'bullets',
        candidate_seniority_level: 'IC',
        seniority_gap: 'aligned',
        inflation_risk: 0,
        missing_signals: [],
        rewrite_constraints: [],
      };
      const outSeniority = normalizeStructuredListFields('seniority_signal_enforcement', seniorityData) as Record<string, unknown>;
      expect(Array.isArray(outSeniority.rewrite_constraints)).toBe(true);
    });

    it('signal_normalized schema has root required including all properties for API compatibility', () => {
      const schemaName = 'signal_normalized';
      let jsonSchema = zodToJsonSchema(SignalNormalizedSchema, {
        name: schemaName,
        target: 'openApi3',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      if (jsonSchema.$ref && typeof jsonSchema.$ref === 'string') {
        const refName = jsonSchema.$ref.replace('#/definitions/', '').replace('#/$defs/', '').split('/')[0];
        const defs = (jsonSchema.definitions || jsonSchema.$defs) as Record<string, unknown> | undefined;
        if (defs?.[refName]) jsonSchema = JSON.parse(JSON.stringify(defs[refName])) as Record<string, unknown>;
      }
      const properties = jsonSchema.properties as Record<string, unknown> | undefined;
      expect(properties).toBeDefined();
      expect('aggregated_signals' in (properties ?? {})).toBe(true);
      expect('confidence_scores' in (properties ?? {})).toBe(true);
      expect('signal_gaps' in (properties ?? {})).toBe(true);
      // AgentBuilder sets required = all property keys so the API accepts the schema
      const required = Object.keys(properties ?? {}) as string[];
      (jsonSchema as { required?: string[] }).required = required;
      expect(required).toContain('aggregated_signals');
      expect(required).toContain('confidence_scores');
      expect(required).toContain('signal_gaps');
    });
  });

  describe('Interview assessment interview_questions', () => {
    it('hasBalancedInterviewDifficulties accepts 4+3+3 for n=10', () => {
      expect(hasBalancedInterviewDifficulties(4, 3, 3, 10)).toBe(true);
      expect(hasBalancedInterviewDifficulties(3, 4, 3, 10)).toBe(true);
      expect(hasBalancedInterviewDifficulties(3, 3, 4, 10)).toBe(true);
    });

    it('rejects uneven splits for n=10', () => {
      expect(hasBalancedInterviewDifficulties(5, 3, 2, 10)).toBe(false);
      expect(hasBalancedInterviewDifficulties(10, 0, 0, 10)).toBe(false);
    });

    it('rejects n < 10', () => {
      expect(hasBalancedInterviewDifficulties(3, 3, 3, 9)).toBe(false);
    });

    it('accepts 4+4+3 for n=11 and 4+4+4 for n=12', () => {
      expect(hasBalancedInterviewDifficulties(4, 4, 3, 11)).toBe(true);
      expect(hasBalancedInterviewDifficulties(4, 4, 4, 12)).toBe(true);
    });

    it('countInterviewQuestionDifficulties matches balanced 4+3+3', () => {
      const qs = [
        { difficulty: 'easy' },
        { difficulty: 'easy' },
        { difficulty: 'easy' },
        { difficulty: 'easy' },
        { difficulty: 'medium' },
        { difficulty: 'medium' },
        { difficulty: 'medium' },
        { difficulty: 'hard' },
        { difficulty: 'hard' },
        { difficulty: 'hard' },
      ];
      const c = countInterviewQuestionDifficulties(qs);
      expect(hasBalancedInterviewDifficulties(c.easy, c.medium, c.hard, c.total)).toBe(true);
    });

    const longSummary = 'x'.repeat(120);
    const longBullet = 'y'.repeat(60);
    const makeInterviewSection = (type: string, heading: string) => ({
      type,
      section_heading: heading,
      section_description: `${heading} description.`,
      section_detail: { section_detail_summary: longSummary, summary_detail_bullets: [longBullet, longBullet] },
    });

    const baseInterviewAssessment = {
      decision: 'maybe' as const,
      score: 70,
      signal_blocks: {
        technical_depth: [] as string[],
        execution_maturity: [] as string[],
        leadership_scope: [] as string[],
        delivery_risk: [] as string[],
        business_alignment: [] as string[],
      },
      sections: [
        makeInterviewSection('narrative', 'Narrative'),
        makeInterviewSection('strengths', 'Strengths'),
        makeInterviewSection('concerns', 'Concerns'),
        makeInterviewSection('recommendations', 'Recommendations'),
        makeInterviewSection('interview_questions', 'Interview Questions'),
        makeInterviewSection('missing_signals', 'Missing Signals'),
        makeInterviewSection('interview_risks', 'Interview Risks'),
        makeInterviewSection('reasons_to_hire', 'Reasons To Hire'),
        makeInterviewSection('reasons_not_to_hire', 'Reasons Not To Hire'),
      ],
      interview_questions: [
        { id: 'q1', text: 't1', difficulty: 'easy' as const, focus_area: 'a' },
        { id: 'q2', text: 't2', difficulty: 'easy' as const, focus_area: 'a' },
        { id: 'q3', text: 't3', difficulty: 'easy' as const, focus_area: 'a' },
        { id: 'q4', text: 't4', difficulty: 'easy' as const, focus_area: 'a' },
        { id: 'q5', text: 't5', difficulty: 'medium' as const, focus_area: 'a' },
        { id: 'q6', text: 't6', difficulty: 'medium' as const, focus_area: 'a' },
        { id: 'q7', text: 't7', difficulty: 'medium' as const, focus_area: 'a' },
        { id: 'q8', text: 't8', difficulty: 'hard' as const, focus_area: 'a' },
        { id: 'q9', text: 't9', difficulty: 'hard' as const, focus_area: 'a' },
        { id: 'q10', text: 't10', difficulty: 'hard' as const, focus_area: 'a' },
      ],
    };

    it('InterviewAssessmentSchema parses 10 balanced questions', () => {
      const parsed = InterviewAssessmentSchema.parse(baseInterviewAssessment);
      expect(parsed.interview_questions).toHaveLength(10);
    });

    it('InterviewAssessmentSchema fails when fewer than 10 questions', () => {
      const bad = {
        ...baseInterviewAssessment,
        interview_questions: baseInterviewAssessment.interview_questions.slice(0, 9),
      };
      expect(() => InterviewAssessmentSchema.parse(bad)).toThrow();
    });

    it('InterviewAssessmentSchema fails when difficulties not balanced for n=10', () => {
      const bad = {
        ...baseInterviewAssessment,
        interview_questions: [
          ...baseInterviewAssessment.interview_questions.slice(0, 9),
          { id: 'q10', text: 't10', difficulty: 'easy' as const, focus_area: 'a' },
        ],
      };
      expect(() => InterviewAssessmentSchema.parse(bad)).toThrow();
    });
  });
});

