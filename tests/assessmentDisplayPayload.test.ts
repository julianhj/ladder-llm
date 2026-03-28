import {
  buildAssessmentDisplayDocument,
  type RecruitmentResponseForDisplay,
} from '../src/recruitment/assessmentDisplayPayload.js';

describe('buildAssessmentDisplayDocument', () => {
  const minimal: RecruitmentResponseForDisplay = {
    candidate: {
      name: 'A',
      email: 'a@b.c',
      company_name: 'Co',
      role_applying_for: 'Eng',
      criticality_level: 'objective',
      verbosity_level: 'moderate',
      cv_optimization_level: 'moderate',
      audience_perspective: 'candidate',
    },
    stages: [
      {
        stageId: 'stage_14_consensus_decision',
        stageName: 'Consensus',
        agents: [
          {
            agentId: 'consensus_decision_maker',
            agentName: 'Consensus Decision Maker',
            outputSchema: 'consensus',
            result: { final_decision: 'maybe', score: 70 },
          },
        ],
      },
      {
        stageId: 'stage_3_interviews',
        stageName: 'Interviews',
        agents: [
          {
            agentId: 'technical_interviewer',
            agentName: 'Technical Interviewer',
            outputSchema: 'x',
            result: { score: 72 },
          },
        ],
      },
      {
        stageId: 'stage_15_final_decision',
        stageName: 'Final',
        agents: [
          {
            agentId: 'merged',
            agentName: 'Merged',
            outputSchema: 'assessment',
            result: { optimized_cv: { sections: [] } },
          },
        ],
      },
    ],
    metadata: {
      executionTimeMs: 1000,
      totalStages: 3,
      totalAgents: 3,
      correlationToken: 'test-assessment-id',
    },
  };

  it('maps consensus_decision_maker to summary', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'test-assessment-id' });
    expect(doc.assessmentId).toBe('test-assessment-id');
    expect(doc.summary).toEqual({ final_decision: 'maybe', score: 70 });
    expect('consensus' in doc).toBe(false);
  });

  it('includes interview slot for technical_interviewer', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    const tech = doc.interviews.find((i) => i.agentId === 'technical_interviewer');
    expect(tech?.result).toEqual({ score: 72 });
  });

  it('returns null for missing agents', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect(doc.careerTrajectory).toBeNull();
    expect('companyBackground' in doc).toBe(false);
  });

  it('surfaces merged as cvOptimization', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect(doc.cvOptimization).toEqual({ optimized_cv: { sections: [] } });
  });

  it('does not expose roleSuccessModel or metadata (client-facing document only)', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect('roleSuccessModel' in doc).toBe(false);
    expect('metadata' in doc).toBe(false);
  });

  it('does not expose challengeAndValidation (counterfactual is internal; full assessment stages only)', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect('challengeAndValidation' in doc).toBe(false);
  });

  it('omits section_level_cv_rewriter from cvPipelineDetail (redundant with cvOptimization)', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect('section_level_cv_rewriter' in doc.cvPipelineDetail).toBe(false);
  });

  it('includes experience_representation_formatter slot on cvPipelineDetail (null when absent)', () => {
    const doc = buildAssessmentDisplayDocument(minimal, { assessmentId: 'x' });
    expect(doc.cvPipelineDetail.experience_representation_formatter).toBeNull();
  });
});
