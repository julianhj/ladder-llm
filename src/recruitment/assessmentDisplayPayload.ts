/** Input shape matches RecruitmentResponse (defined in index to avoid circular import). */
export type RecruitmentResponseForDisplay = {
  candidate: {
    name: string;
    email: string;
    company_name: string;
    role_applying_for: string;
    criticality_level: string;
    verbosity_level: string;
    cv_optimization_level: string;
    audience_perspective: string;
    job_posted_by_recruiter?: boolean;
  };
  stages: Array<{
    stageId: string;
    stageName: string;
    agents: Array<{
      agentId: string;
      agentName: string;
      outputSchema: string;
      result: unknown | null;
      error?: { message: string; code?: string; retryable?: boolean };
    }>;
  }>;
  metadata: {
    executionTimeMs: number;
    totalStages: number;
    totalAgents: number;
    correlationToken: string;
    tokenUsage?: {
      preprocessing?: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number;
        model?: string;
      };
      perAgent: Array<{
        name: string;
        model?: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      perStage?: Array<{
        stageId: string;
        stageName: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      perPipelineRun: { inputTokens: number; outputTokens: number; totalTokens: number };
      perCandidate: { inputTokens: number | null; outputTokens: number | null; totalTokens: number };
      perModelPipelineRun?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      perModelPerCandidate?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
    };
  };
};

const INTERVIEW_AGENT_IDS = [
  'hiring_manager',
  'technical_interviewer',
  'soft_skills_interviewer',
  'leadership_interviewer',
  'recruiter',
] as const;

function findAgent(
  stages: RecruitmentResponseForDisplay['stages'],
  agentId: string
): { agentId: string; agentName: string; outputSchema: string; result: unknown | null; error?: { message: string; code?: string; retryable?: boolean } } | null {
  if (!stages?.length) return null;
  for (const stage of stages) {
    const agent = stage.agents?.find((a) => a.agentId === agentId);
    if (agent) return agent;
  }
  return null;
}

function agentResult(stages: RecruitmentResponseForDisplay['stages'], agentId: string): unknown | null {
  const a = findAgent(stages, agentId);
  if (!a) return null;
  if (a.error) {
    return {
      error: {
        message: a.error.message ?? 'Agent run failed',
        code: a.error.code,
        retryable: a.error.retryable,
      },
    };
  }
  return a.result ?? null;
}

/**
 * Client-facing assessment payload for GET /assessments/:id (and the saved file written alongside assessment).
 * Built from the full pipeline response. Omits internal-only fields: role success model and run metadata
 * stay on the raw recruitment response / stage results only.
 */
export interface AssessmentDisplayDocument {
  assessmentId: string;
  savedAt: string;
  candidate: RecruitmentResponseForDisplay['candidate'];
  /** Consensus decision maker output: scores, narrative, strengths, final_decision, etc. */
  summary: unknown | null;
  careerTrajectory: unknown | null;
  interviews: Array<{
    agentId: string;
    agentName: string;
    outputSchema: string;
    result: unknown | null;
  }>;
  /** Merged CV optimizer output (optimized_cv, missing_skills, role_fit, etc.). */
  cvOptimization: unknown | null;
  /**
   * Stage-15 agent outputs not fully folded into {@link cvOptimization}.
   * Omits section_level_cv_rewriter: rewritten sections live under cvOptimization.optimized_cv;
   * changes_made and rationale are merged into cvOptimization already.
   */
  cvPipelineDetail: {
    evidence_integration: unknown | null;
    seniority_recruiter_reality_enforcement: unknown | null;
    skill_representation_formatter: unknown | null;
    experience_representation_formatter: unknown | null;
    role_fit_ats_enhancement: unknown | null;
  };
}

export function buildAssessmentDisplayDocument(
  response: RecruitmentResponseForDisplay,
  options: { assessmentId: string; savedAt?: string }
): AssessmentDisplayDocument {
  const { stages, candidate } = response;
  const savedAt = options.savedAt ?? new Date().toISOString();
  const consensusResult = agentResult(stages, 'consensus_decision_maker');

  const interviews = INTERVIEW_AGENT_IDS.map((id) => {
    const a = findAgent(stages, id);
    return {
      agentId: id,
      agentName: a?.agentName ?? id,
      outputSchema: a?.outputSchema ?? '',
      result: a?.error
        ? {
            error: {
              message: a.error.message ?? 'Agent run failed',
              code: a.error.code,
              retryable: a.error.retryable,
            },
          }
        : (a?.result ?? null),
    };
  });

  return {
    assessmentId: options.assessmentId,
    savedAt,
    candidate,
    summary: consensusResult,
    careerTrajectory: agentResult(stages, 'career_trajectory_analysis'),
    interviews,
    cvOptimization: agentResult(stages, 'merged'),
    cvPipelineDetail: {
      evidence_integration: agentResult(stages, 'evidence_integration'),
      seniority_recruiter_reality_enforcement: agentResult(stages, 'seniority_recruiter_reality_enforcement'),
      skill_representation_formatter: agentResult(stages, 'skill_representation_formatter'),
      experience_representation_formatter: agentResult(stages, 'experience_representation_formatter'),
      role_fit_ats_enhancement: agentResult(stages, 'role_fit_ats_enhancement'),
    },
  };
}
