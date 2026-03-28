/**
 * Token Estimation Utilities
 * 
 * Estimates token usage for OpenAI API calls.
 * Uses approximation: ~4 characters per token for English text (conservative estimate).
 * For more accurate estimates, consider using tiktoken library.
 */

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentTokenEstimate extends TokenEstimate {
  agentName: string;
  outputSchema: string;
  /** Resolved model id for this agent (config merge + openai default). */
  model?: string;
}

export interface PipelineTokenEstimate {
  perAgent: AgentTokenEstimate[];
  perPipelineRun: TokenEstimate;
  perCandidate: TokenEstimate; // Assuming 1 pipeline run per candidate
}

/**
 * Estimates tokens from text content
 * Approximation: 1 token ≈ 4 characters for English text
 * This is a conservative estimate (actual may be slightly lower)
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Conservative estimate: 4 characters per token
  // OpenAI's tiktoken typically gives ~3.5-4 chars per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Estimates output tokens based on output schema requirements
 */
export type OutputSchemaForEstimate =
  | 'assessment'
  | 'interview_assessment'
  | 'cv_optimization'
  | 'career_guidance'
  | 'final_decision'
  | 'consensus'
  | 'signal_normalized'
  | 'recruiter_reality_validation'
  | 'evidence_synthesiser'
  | 'panel_weighting'
  | 'anomaly_detection'
  | 'seniority_signal_enforcement'
  | 'preprocessing'
  | 'evidence_validated'
  | 'enforced_claims'
  | 'formatted_skills'
  | 'formatted_experience'
  | 'profile_narrative_rewrite'
  | 'rewritten_sections'
  | 'role_fit_summary'
  | 'career_trajectory_profile'
  | 'role_success_profile'
  | 'evidence_traceability'
  | 'calibrated_signals'
  | 'counterfactual_challenge_report'
  | 'optimized_structured_cv'
  | 'structured_job_description';

export function estimateOutputTokens(outputSchema: OutputSchemaForEstimate): number {
  switch (outputSchema) {
    case 'preprocessing':
      // Preprocessing: Structured CV or Job Description
      // Structured JSON is typically more compact than raw text
      // Typical: ~200-400 words for structured CV/job description ≈ 800-1600 chars ≈ 200-400 tokens
      return 300; // Conservative estimate for structured extraction
      
    case 'assessment':
      // AssessmentResult: sections (all 8 types required)
      // Typical: ~500-800 words total ≈ 2000-3200 chars ≈ 500-800 tokens
      return 600; // Conservative estimate

    case 'interview_assessment':
      // InterviewAssessmentResult: sections (subset of types; single interviewer perspective)
      return 600; // Same conservative estimate as assessment

    case 'cv_optimization':
      // CVOptimizationResult: optimized_cv (object), changes_made (array), rationale, ats_optimization, keyword_enhancements
      // Can be large if CV is extensive, but typically structured JSON
      // Typical: ~300-600 words ≈ 1200-2400 chars ≈ 300-600 tokens
      return 400; // Conservative estimate
      
    case 'career_guidance':
      // CareerGuidanceResult: career_advice, interview_feedback_summary
      return 1000; // Conservative estimate
      
    case 'final_decision':
      // FinalDecisionResult: final_decision, confidence, reasoning, next_steps (array)
      // Typically shorter, focused decision
      // Typical: ~200-400 words ≈ 800-1600 chars ≈ 200-400 tokens
      return 300; // Conservative estimate

    case 'consensus':
      // ConsensusResult: assessment fields + final_decision, confidence, reasoning, next_steps
      // Combined output: consensus assessment + executive decision
      return 900; // Conservative estimate (assessment ~600 + final_decision ~300)

    case 'signal_normalized':
      // SignalNormalized: aggregated_signals (5 arrays), confidence_scores, signal_gaps
      return 600;

    case 'recruiter_reality_validation':
      // RecruiterRealityValidation: credibility_score, inflation_flags, director_signal_gaps, rewrite_constraints
      return 400;

    case 'evidence_synthesiser':
      // EvidenceSynthesiser: scope/execution/leadership/business/risk signals + signal_confidence
      return 500;

    case 'panel_weighting':
      // PanelWeighting: weighted_scores, panel_confidence, panel_risk_flags
      return 200;

    case 'anomaly_detection':
      // AnomalyDetection: anomaly_detected, anomaly_type, confidence_score, affected_fields
      return 150;

    case 'seniority_signal_enforcement':
      // SenioritySignalEnforcement: target/candidate level, gap, inflation_risk, missing_signals, rewrite_constraints
      return 350;

    case 'evidence_validated':
      return 600; // Validated signal arrays + reasoning_notes
    case 'enforced_claims':
      return 500; // Enforced claims arrays + rationale
    case 'formatted_skills':
      return 400; // skills_formatted + missing_skills
    case 'formatted_experience':
      return 800; // experience_formatted array (per-role text can be large)
    case 'profile_narrative_rewrite':
      return 600; // profile-focused rewritten sections + rationale
    case 'rewritten_sections':
      return 2500; // Full sections array (largest Stage 3 output)
    case 'role_fit_summary':
      return 600; // role_fit_summary + ats_optimization + keyword_enhancements

    default:
      return 500; // Default fallback
  }
}

/**
 * Estimates tokens for a single agent invocation
 * NOTE: With preprocessing, inputContext contains structured JSON instead of raw text,
 * which is typically 20-40% more token-efficient than raw text
 * 
 * @param isStructuredInput - Optional flag indicating if input uses structured JSON.
 *   If not provided, will check inputContext string (less efficient).
 *   Pass this flag from AgentBuilder to avoid expensive string searching.
 */
export function estimateAgentTokens(
  agentName: string,
  prompt: string,
  inputContext: string,
  outputSchema: OutputSchemaForEstimate,
  isStructuredInput?: boolean
): AgentTokenEstimate {
  const inputText = prompt + inputContext;
  
  // Performance optimization: Use provided flag if available, otherwise fall back to string search
  // String search is O(n) and can be slow for large inputContext strings
  let isStructured: boolean;
  if (isStructuredInput !== undefined) {
    isStructured = isStructuredInput;
  } else {
    // Fallback: Check if inputContext contains structured JSON (indicated by section headers)
    // This is less efficient but maintains backward compatibility
    isStructured = inputContext.indexOf('### structuredCV') !== -1 || 
                   inputContext.indexOf('### structuredJobDescription') !== -1;
  }
  
  const efficiencyFactor = isStructured ? 0.7 : 1.0; // 30% reduction for structured data
  
  const inputTokens = Math.ceil(estimateTokensFromText(inputText) * efficiencyFactor);
  const outputTokens = estimateOutputTokens(outputSchema);
  const totalTokens = inputTokens + outputTokens;
  
  return {
    agentName,
    outputSchema,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

/**
 * Estimates preprocessing tokens (unstructured CV and unstructured job description extraction).
 * Preprocessing runs in parallel, so we estimate both extractions.
 */
export function estimatePreprocessingTokens(
  unstructuredCVText: string,
  unstructuredJobDescriptionText: string
): TokenEstimate {
  // Estimate input tokens for both extractions (unstructured = raw text input)
  const cvPromptSize = 2000; // Approximate prompt size for CV extractor
  const jobPromptSize = 2000; // Approximate prompt size for job extractor

  const cvInputTokens = estimateTokensFromText(unstructuredCVText) + Math.ceil(cvPromptSize / 4);
  const jobInputTokens = estimateTokensFromText(unstructuredJobDescriptionText) + Math.ceil(jobPromptSize / 4);
  
  // Both run in parallel, so total input is the sum
  const inputTokens = cvInputTokens + jobInputTokens;
  
  // Output tokens for both structured extractions
  const cvOutputTokens = estimateOutputTokens('preprocessing');
  const jobOutputTokens = estimateOutputTokens('preprocessing');
  const outputTokens = cvOutputTokens + jobOutputTokens;
  
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Estimates tokens for the entire pipeline
 */
export function estimatePipelineTokens(
  agentEstimates: AgentTokenEstimate[],
  pipelineRunsPerCandidate: number = 1
): PipelineTokenEstimate {
  // Sum up all agent tokens for one pipeline run
  const perPipelineRun: TokenEstimate = agentEstimates.reduce(
    (acc, agent) => ({
      inputTokens: acc.inputTokens + agent.inputTokens,
      outputTokens: acc.outputTokens + agent.outputTokens,
      totalTokens: acc.totalTokens + agent.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
  
  // Multiply by number of pipeline runs per candidate
  const perCandidate: TokenEstimate = {
    inputTokens: perPipelineRun.inputTokens * pipelineRunsPerCandidate,
    outputTokens: perPipelineRun.outputTokens * pipelineRunsPerCandidate,
    totalTokens: perPipelineRun.totalTokens * pipelineRunsPerCandidate,
  };
  
  return {
    perAgent: agentEstimates,
    perPipelineRun,
    perCandidate,
  };
}

/**
 * Formats token estimate for logging
 */
export function formatTokenEstimate(estimate: TokenEstimate): string {
  return `Input: ${estimate.inputTokens.toLocaleString()}, Output: ${estimate.outputTokens.toLocaleString()}, Total: ${estimate.totalTokens.toLocaleString()}`;
}

/**
 * Estimates cost based on token usage and pricing config
 * @param tokens Token estimate
 * @param pricing Optional pricing config (defaults to gpt-4o-mini pricing)
 */
/**
 * Estimates cost including preprocessing step
 */
export function estimateCostWithPreprocessing(
  pipelineEstimate: PipelineTokenEstimate,
  preprocessingEstimate: TokenEstimate,
  pricing?: { inputCostPerMillion: number; outputCostPerMillion: number; currency: string }
): { totalCost: number; currency: string; breakdown: { preprocessing: number; pipeline: number } } {
  const pipelineCost = estimateCost(pipelineEstimate.perCandidate, pricing);
  
  if (!pricing) {
    return {
      totalCost: pipelineCost,
      currency: 'USD',
      breakdown: { preprocessing: 0, pipeline: pipelineCost },
    };
  }
  
  const preprocessingInputCost = (preprocessingEstimate.inputTokens / 1_000_000) * pricing.inputCostPerMillion;
  const preprocessingOutputCost = (preprocessingEstimate.outputTokens / 1_000_000) * pricing.outputCostPerMillion;
  const preprocessingCost = preprocessingInputCost + preprocessingOutputCost;
  
  return {
    totalCost: preprocessingCost + pipelineCost,
    currency: pricing.currency || 'USD',
    breakdown: {
      preprocessing: preprocessingCost,
      pipeline: pipelineCost,
    },
  };
}

export function estimateCost(
  tokens: TokenEstimate,
  pricing?: { inputCostPerMillion: number; outputCostPerMillion: number }
): number {
  const INPUT_COST_PER_MILLION = pricing?.inputCostPerMillion ?? 0.15;
  const OUTPUT_COST_PER_MILLION = pricing?.outputCostPerMillion ?? 0.60;
  
  const inputCost = (tokens.inputTokens / 1_000_000) * INPUT_COST_PER_MILLION;
  const outputCost = (tokens.outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION;
  
  return inputCost + outputCost;
}

