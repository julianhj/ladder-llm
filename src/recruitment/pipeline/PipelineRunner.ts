import { AgentBuilder, CandidateProfile, getOpenAIConfig } from '../agents/AgentBuilder.js';
import type { StageConfig, MergeOutputsConfig } from '../loaders/ConfigLoader.js';
import { Logger } from '../utils/Logger.js';
import { estimatePipelineTokens, PipelineTokenEstimate, formatTokenEstimate, estimateCost } from '../utils/TokenEstimator.js';
import { ExecutionTimeTracker } from '../utils/ExecutionTimeTracker.js';
import type { RequestScopedContext } from '../requestScopedContext.js';
import { buildSignalGraph, type SignalGraph } from '../logic/signal_layer/signalGraph.js';
import { computeScoreAndDecision } from '../logic/signal_layer/scoreCandidate.js';
import { inferSeniority } from '../logic/signal_layer/inferSeniority.js';
import { computeConfidenceScores } from '../logic/signal_layer/confidence.js';
import { buildEvidence, type EvidenceItem } from '../logic/signal_layer/buildEvidence.js';
import { computeEvidenceCoverage } from '../logic/signal_layer/evidenceCoverage.js';
import { calibrateSignals, inferSkillRepresentationMode, type CalibratedSignalGraph, type SkillRepresentationMode } from '../logic/signal_layer/signalCalibration.js';
import { buildAuditLog } from '../logic/stage_10_audit_logging/auditLog.js';
import { buildCompactSignalSummary } from '../logic/stage_14_consensus_decision/compactSignalSummary.js';
import { aggregateSignalConfidence } from '../logic/stage_9_signal_confidence_aggregation/aggregateSignalConfidence.js';
import { getSignalBlocksFromSignalNormalisation } from './stage_14_consensus_decision/signalBlocks.js';
import { mergeStage3Outputs } from './stage_15_final_decision/mergeStage3.js';
import { cvOptimizationHandler } from '../agents/stage_15_final_decision/cvOptimizationHandler.js';
import type { MergeOutputsCombineConfig } from '../loaders/ConfigLoader.js';
import type { AgentInputRef, PreviousStageResultsRef } from '../agents/agentConfig.js';
import { getStructuredCvFieldForAgentInput } from './structuredCvSlices.js';

/** Error code from OpenAI when account quota is exceeded (not retryable). */
const INSUFFICIENT_QUOTA_CODE = 'insufficient_quota';

/**
 * Message thrown when tests hit API quota so the run stops and the user gets a clear error.
 * See .cursor/rules/openai-quota-tests.mdc for rule.
 */
export const INSUFFICIENT_QUOTA_TEST_MESSAGE =
  'OpenAI API quota exceeded (insufficient_quota). Tests stopped to avoid further usage. Check your plan and billing at https://platform.openai.com/account/billing.';

function failFastOnQuotaInTest(stageName: string, results: AgentResult[]): void {
  if (typeof process.env.JEST_WORKER_ID === 'string') {
    const quotaError = results.find(
      (r) => !r.success && (r.error?.code === INSUFFICIENT_QUOTA_CODE || r.error?.message?.includes('exceeded your current quota'))
    );
    if (quotaError) {
      const msg = `${INSUFFICIENT_QUOTA_TEST_MESSAGE} Failed at stage: ${stageName}, agent: ${quotaError.agentName}.`;
      console.error('\n' + msg + '\n');
      process.exit(1);
    }
  }
}

export interface AgentResult {
  success: boolean;
  agentId: string;
  agentName: string;
  result?: unknown;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Present when usage comes from AgentBuilder.invokeAgent. */
    model?: string;
  };
  error?: {
    message: string;
    code?: string;
    retryable?: boolean;
  };
}

export interface StageResult {
  stageId: string;
  stageName: string;
  results: AgentResult[];
}

/** Stage ids for branching (synthetic stage not in agents.json). */
export const STAGE_10_AUDIT_ID = 'stage_10_audit_logging';
export const AGENT_MERGED_RESEARCH = 'merged_research';
/** Single Stage 14 agent; runner merges signal overlay into this result in place (no synthetic row). */
const CONSENSUS_DECISION_MAKER_ID = 'consensus_decision_maker';
export const AGENT_MERGED = 'merged';
export const AGENT_AUDIT_LOGGER = 'audit_logger';

export type { SkillRepresentationMode };
type ExperienceFormat = 'bullets' | 'hybrid' | 'narrative';
type SeniorityClass =
  | 'entry'
  | 'intermediate'
  | 'senior'
  | 'lead'
  | 'manager'
  | 'head'
  | 'executive'
  | 'unknown';

function resolveExperienceFormat(input?: string): ExperienceFormat {
  if (input === 'bullets' || input === 'hybrid' || input === 'narrative') return input;
  return 'bullets';
}

export interface SignalLayerPayload {
  signal_graph: SignalGraph;
  computed_score: number;
  final_decision: 'hire' | 'maybe' | 'declined';
  inferred_seniority: string;
  confidence_scores: Record<string, number>;
  evidence_items: EvidenceItem[];
  evidence_coverage_score: number;
  calibrated_signals: Record<string, number>;
  calibrated_signal_graph?: CalibratedSignalGraph;
  skill_representation_mode?: SkillRepresentationMode;
}

export function getSignalLayerPayload(
  mainStageResults: StageResult[],
  candidateProfile?: CandidateProfile | null
): SignalLayerPayload | null {
  const stage1 = mainStageResults.find(s => s.stageId === 'stage_3_interviews');
  const stage2SignalNorm = mainStageResults.find(s => s.stageId === 'stage_4_signal_normalisation');
  const stage3Evidence = mainStageResults.find(s => s.stageId === 'stage_6_evidence_synthesiser');
  const stage4Panel = mainStageResults.find(s => s.stageId === 'stage_8_panel_weighting');
  const s1Results = stage1 ? stage1.results.filter((r: AgentResult) => r.success) : [];
  const signalNormResults = stage2SignalNorm ? stage2SignalNorm.results.filter((r: AgentResult) => r.success) : [];
  const evidenceResults = stage3Evidence ? stage3Evidence.results.filter((r: AgentResult) => r.success) : [];
  const panelWeightingResults = stage4Panel ? stage4Panel.results.filter((r: AgentResult) => r.success) : [];
  if (panelWeightingResults.length === 0) return null;

  const evidenceItems = candidateProfile
    ? buildEvidence(candidateProfile.structured_cv, candidateProfile.structured_job_description)
    : [];
  const graph = buildSignalGraph(s1Results, signalNormResults, evidenceResults, panelWeightingResults, { evidenceItems });
  const evidence_coverage_score = computeEvidenceCoverage(graph);
  const calibrated_signal_graph = calibrateSignals(graph, evidence_coverage_score);
  const calibrated_signals = calibrated_signal_graph.calibrated_scores ?? {};

  const { computed_score, final_decision } = computeScoreAndDecision(graph);
  const inferred_seniority = inferSeniority(graph);
  const confidence_scores = computeConfidenceScores(graph);

  const stage7 = mainStageResults.find(s => s.stageId === 'stage_13_seniority_signal_enforcement');
  const stage7Result = stage7?.results?.find((r: AgentResult) => r.success)?.result as {
    target_seniority_level?: string;
    target_seniority_class?: SeniorityClass;
    skill_representation_mode?: SkillRepresentationMode;
    experience_format?: ExperienceFormat;
  } | undefined;
  const skill_representation_mode = inferSkillRepresentationMode({
    llmSkillRepresentationMode: stage7Result?.skill_representation_mode,
  });

  return {
    signal_graph: graph,
    computed_score,
    final_decision,
    inferred_seniority,
    confidence_scores,
    evidence_items: evidenceItems,
    evidence_coverage_score,
    calibrated_signals,
    calibrated_signal_graph,
    skill_representation_mode,
  };
}

/**
 * Returns a copy of the signal layer payload with all CV/JD evidence excerpts removed.
 * Use for consensus agents so they receive scores and structure but not raw CV/JD text.
 */
export function getSignalLayerPayloadWithoutEvidence(
  payload: SignalLayerPayload
): SignalLayerPayload {
  const { signal_graph, calibrated_signal_graph } = payload;
  const signal_graphNoEvidence = { ...signal_graph, evidence: [] };
  const calibrated_signal_graphNoEvidence = calibrated_signal_graph
    ? { ...calibrated_signal_graph, evidence: [] }
    : undefined;
  return {
    ...payload,
    evidence_items: [],
    signal_graph: signal_graphNoEvidence,
    calibrated_signal_graph: calibrated_signal_graphNoEvidence,
  };
}

export interface PipelineStage {
  id: string;
  name: string;
  agents: AgentBuilder[];
  parallel?: boolean;
  mergeOutputs?: MergeOutputsConfig;
}

export class PipelineRunner {
  public stages: PipelineStage[] = [];
  private candidateProfile: CandidateProfile;
  private parallelStageGroups: string[][] = [];

  constructor(
    agentConfigsByStage: StageConfig[],
    candidateProfile: CandidateProfile,
    parallelStageGroups?: string[][]
  ) {
    this.candidateProfile = candidateProfile;
    this.parallelStageGroups = parallelStageGroups ?? [];
    this.stages = agentConfigsByStage.map(stage => ({
      id: stage.id,
      name: stage.name,
      agents: stage.agents.map(config => new AgentBuilder(config, candidateProfile)),
      parallel: stage.parallel,
      mergeOutputs: stage.mergeOutputs,
    }));
  }

  /** Stage ids that run in parallel with the pipeline (first element of parallelStageGroups). */
  private get pipelineParallelStageIds(): string[] {
    return this.parallelStageGroups[0] ?? [];
  }

  /** Groups used for batch execution (parallelStageGroups excluding the first element). */
  private get batchStageGroups(): string[][] {
    return this.parallelStageGroups.slice(1);
  }

  /** True if any agent in the stage has an input ref to the given stage id (previousStageResults from that stage or composite including it). */
  private static stageDependsOn(stage: PipelineStage, stageId: string): boolean {
    for (const agent of stage.agents) {
      const ref = agent.config.inputs?.previousStageResults;
      if (!ref || typeof ref !== 'object' || !('from' in ref)) continue;
      const r = ref as PreviousStageResultsRef;
      if (r.from === 'stage' && r.stageId === stageId) return true;
      if (r.from === 'composite' && (r.stageIds?.includes(stageId) ?? false)) return true;
    }
    return false;
  }

  /** Starts one stage that has runInParallelWithPipeline; returns a promise that resolves to its StageResult. */
  private startParallelPipelineStage(parallelStage: PipelineStage, tracker: ExecutionTimeTracker): Promise<StageResult> {
    Logger.info('PipelineRunner', 'Starting parallel-pipeline stage in parallel with all other pipeline stages', {
      stageName: parallelStage.name,
      agentNames: parallelStage.agents.map(a => a.config.name),
      mergeOutputs: !!parallelStage.mergeOutputs,
    });
    this.injectInputRefsForAgents(parallelStage.agents);
    return this.runParallelAgents(parallelStage.agents, parallelStage.id, parallelStage.name, tracker)
      .then((results) => {
        const stageResult: StageResult = { stageId: parallelStage.id, stageName: parallelStage.name, results };
        const singleResult = results.length === 1 && results[0].success && results[0].result != null ? results[0] : null;
        const singleHasSections =
          singleResult &&
          typeof singleResult.result === 'object' &&
          Array.isArray((singleResult.result as Record<string, unknown>).sections);
        if (singleHasSections) {
          stageResult.results.push({
            success: true,
            agentId: AGENT_MERGED_RESEARCH,
            agentName: 'Merged Research',
            result: singleResult!.result,
          });
        }
        return stageResult;
      })
      .catch((err: Error) => {
        Logger.warn('PipelineRunner', 'Parallel-pipeline stage failed', {
          stageName: parallelStage.name,
          error: err.message,
        });
        return {
          stageId: parallelStage.id,
          stageName: parallelStage.name,
          results: [{
            success: false,
            agentId: parallelStage.agents[0]?.config.id ?? 'background',
            agentName: parallelStage.agents[0]?.config.name ?? 'Background',
            error: {
              message: err.message,
              code: (err as any).code ?? (err as any).status ?? 'UNKNOWN',
              retryable: this.isRetryableError(err),
            },
          }],
        };
      });
  }

  async initAllAgents() {
    const initStartTime = Date.now();
    const totalAgents = this.stages.reduce((sum, stage) => sum + stage.agents.length, 0);
    
    Logger.info('PipelineRunner', 'Initializing all agents', {
      totalAgents,
      stageCount: this.stages.length,
    });

    // Initialize all agents across all stages in parallel
    const allAgents = this.stages.flatMap(stage => stage.agents);
    
    try {
      await Promise.all(allAgents.map(agent => agent.init()));
      const initLatency = Date.now() - initStartTime;
      
      // Estimate token usage after initialization
      const tokenEstimates = allAgents.map(agent => agent.estimateTokens());
      const pipelineEstimate = estimatePipelineTokens(tokenEstimates, 1);
      
      // Get pricing from OpenAI config (optional in test environments)
      const openaiConfig = getOpenAIConfig();
      const pricing = openaiConfig?.pricing;
      const estimatedCost = pricing ? estimateCost(pipelineEstimate.perCandidate, pricing) : 0;
      const currency = pricing?.currency || 'USD';
      
      Logger.info('PipelineRunner', 'All agents initialized', {
        totalAgents,
        tokenEstimate: {
          perPipelineRun: formatTokenEstimate(pipelineEstimate.perPipelineRun),
          perCandidate: formatTokenEstimate(pipelineEstimate.perCandidate),
          estimatedCost: `${currency}${estimatedCost.toFixed(4)}`,
        },
      }, initLatency);
    } catch (error) {
      Logger.error('PipelineRunner', 'Failed to initialize agents', error as Error);
      throw error;
    }
  }

  /**
   * Estimates token usage for the entire pipeline
   * @param pipelineRunsPerCandidate Number of times the pipeline runs per candidate (default: 1)
   */
  estimateTokenUsage(pipelineRunsPerCandidate: number = 1): PipelineTokenEstimate {
    const allAgents = this.stages.flatMap(stage => stage.agents);
    const tokenEstimates = allAgents.map(agent => agent.estimateTokens());
    return estimatePipelineTokens(tokenEstimates, pipelineRunsPerCandidate);
  }

  /**
   * Resolve config.inputs refs (from: "input" and optionally from: "stage") and set agent input data.
   * Used for both main-stage agents and parallel-pipeline stage agents so they receive structured CV slices etc.
   */
  private injectInputRefsForAgents(agents: AgentBuilder[], mainStageResults?: StageResult[]): void {
    if (!this.candidateProfile) return;
    const getAtPath = (obj: unknown, path: string): unknown => {
      if (obj == null) return undefined;
      const parts = path.split('.');
      let current: unknown = obj;
      for (const p of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[p];
      }
      return current;
    };
    for (const agent of agents) {
      const inputs = agent.config.inputs;
      if (!inputs) continue;
      for (const [key, ref] of Object.entries(inputs)) {
        if (key === 'previousStageResults') continue;
        if (ref && typeof ref === 'object' && 'from' in ref) {
          const from = (ref as AgentInputRef & { from: string }).from;
          const field = (ref as AgentInputRef & { field?: string }).field;
          if (from === 'input' && field) {
            let val: unknown;
            if (field.startsWith('structuredCV.')) {
              const subpath = field.replace(/^structuredCV\./, '');
              val = getStructuredCvFieldForAgentInput(this.candidateProfile.structured_cv, subpath);
            } else if (field.startsWith('structuredJobDescription.')) {
              val = getAtPath(this.candidateProfile.structured_job_description, field.replace(/^structuredJobDescription\./, ''));
            } else {
              val = getAtPath(this.candidateProfile, field);
            }
            agent.setInputData(key, typeof val === 'string' ? val : JSON.stringify(val ?? '', null, 2));
          } else if (from === 'stage' && (ref as { stageId?: string }).stageId && field && mainStageResults) {
            const stageId = (ref as { stageId: string }).stageId;
            const stageEntry = mainStageResults.find(s => s.stageId === stageId);
            const results = stageEntry ? stageEntry.results.filter((r: AgentResult) => r.success && r.result != null) : [];
            const first = results[0];
            const val = first ? getAtPath(first, field) : undefined;
            agent.setInputData(key, typeof val === 'string' ? val : JSON.stringify(val ?? {}, null, 2));
          }
        }
      }
    }
  }

  /**
   * Run agents in parallel within the same stage
   * Uses Promise.allSettled to allow partial results - if one agent fails, others can still succeed
   */
  private async runParallelAgents(agents: AgentBuilder[], stageId: string, stageName: string, tracker: ExecutionTimeTracker): Promise<AgentResult[]> {
    const parallelStartTime = Date.now();
    
    // High-level scheduling info; keep at debug to avoid noisy runtime logs.
    Logger.debug('PipelineRunner', `Invoking agents for ${stageName}`, {
      stageId,
      stageName,
      agentCount: agents.length,
      agentNames: agents.map(a => a.config.name),
    });
    
    Logger.debug('PipelineRunner', `Running ${agents.length} agents in parallel`, {
      stageName,
      agentNames: agents.map(a => a.config.name),
    });

    // Use Promise.allSettled to allow partial results
    // CRITICAL: This await ensures we wait for ALL agents to complete before returning
    const settledResults = await Promise.allSettled(
      agents.map(agent => {
        return agent.invokeAgent(stageId, stageName, tracker);
      })
    );
    
    const agentResults: AgentResult[] = settledResults.map((settled, index) => {
      const agent = agents[index];
      const agentId = agent.config.id;
      const agentName = agent.config.name;
      
      if (settled.status === 'fulfilled') {
        const value = settled.value as {
          result: unknown;
          tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; model?: string };
        };
        return {
          success: true,
          agentId,
          agentName,
          result: value.result,
          tokenUsage: value.tokenUsage,
        };
      } else {
        const error = settled.reason as Error;
        const isRetryable = this.isRetryableError(error);

        return {
          success: false,
          agentId,
          agentName,
          error: {
            message: error.message,
            code: (error as any).code || (error as any).status || 'UNKNOWN',
            retryable: isRetryable,
          },
        };
      }
    });
    
    const parallelLatency = Date.now() - parallelStartTime;
    const successCount = agentResults.filter(r => r.success).length;
    const failureCount = agentResults.filter(r => !r.success).length;
    
    Logger.debug('PipelineRunner', `Completed parallel agent execution`, {
      stageName,
      agentCount: agents.length,
      successCount,
      failureCount,
      parallelLatencyMs: parallelLatency,
    });

    return agentResults;
  }

  /**
   * Determines if an error is retryable (transient errors that might succeed on retry)
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code || (error as any).status || '';
    
    // Check if error explicitly marks itself as retryable
    if ((error as any).retryable === true) {
      return true;
    }
    
    // JSON parsing errors are retryable (might be transient formatting issues)
    if (errorCode === 'JSON_PARSE_ERROR' || errorMessage.includes('failed to parse json')) {
      return true;
    }
    
    // Rate limit errors (429)
    if (errorCode === 429 || errorMessage.includes('rate limit')) {
      return true;
    }
    
    // Timeout errors
    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return true;
    }
    
    // Server errors (5xx)
    if (typeof errorCode === 'number' && errorCode >= 500 && errorCode < 600) {
      return true;
    }
    
    // Network errors
    if (errorCode === 'ECONNRESET' || errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') {
      return true;
    }
    
    // Request timeout from OpenAI
    if (errorMessage.includes('request timed out')) {
      return true;
    }
    
    return false;
  }

  /** Max wait for background stage once main stages are done. */
  private static readonly BACKGROUND_STAGE_WAIT_TIMEOUT_MS = 120000;

  private getSuccessfulStageResults(mainStageResults: StageResult[], stageId: string): AgentResult[] {
    const entry = mainStageResults.find((stage) => stage.stageId === stageId);
    return entry ? entry.results.filter((result) => result.success) : [];
  }

  private async awaitParallelStageWithTimeout(
    parallelStage: PipelineStage,
    entry: { promise: Promise<StageResult>; startTime: number },
    tracker: ExecutionTimeTracker
  ): Promise<StageResult> {
    const timeoutResult: StageResult = {
      stageId: parallelStage.id,
      stageName: parallelStage.name,
      results: [{
        success: false,
        agentId: parallelStage.agents[0]?.config.id ?? 'unknown',
        agentName: parallelStage.agents[0]?.config.name ?? 'Unknown',
        error: {
          message: `Stage exceeded ${PipelineRunner.BACKGROUND_STAGE_WAIT_TIMEOUT_MS}ms wait limit`,
          code: 'BACKGROUND_STAGE_TIMEOUT',
          retryable: true,
        },
      }],
    };
    const stageResult = await Promise.race<StageResult>([
      entry.promise,
      new Promise<StageResult>((resolve) => {
        setTimeout(() => resolve(timeoutResult), PipelineRunner.BACKGROUND_STAGE_WAIT_TIMEOUT_MS);
      }),
    ]);
    tracker.recordStage(parallelStage.name, entry.startTime, Date.now(), parallelStage.id);
    if (stageResult.results.some((r) => !r.success && r.error?.code === 'BACKGROUND_STAGE_TIMEOUT')) {
      Logger.warn('PipelineRunner', 'Parallel-pipeline stage wait timed out', {
        stageName: parallelStage.name,
        stageId: parallelStage.id,
        timeoutMs: PipelineRunner.BACKGROUND_STAGE_WAIT_TIMEOUT_MS,
      });
    }
    return stageResult;
  }

  private buildStage15PipelineContext(mainStageResults: StageResult[]): Record<string, string> {
    const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
    const consensusStageResults = this.getSuccessfulStageResults(mainStageResults, 'stage_14_consensus_decision');
    const evidenceSynthesiserResults = this.getSuccessfulStageResults(mainStageResults, 'stage_6_evidence_synthesiser');
    const stage12RecruiterRealityResults = this.getSuccessfulStageResults(mainStageResults, 'stage_12_recruiter_reality_validator');
    const stage13SenioritySignalResults = this.getSuccessfulStageResults(mainStageResults, 'stage_13_seniority_signal_enforcement');
    const consensusPrimary = consensusStageResults.find((result) => result.agentId === CONSENSUS_DECISION_MAKER_ID);
    const consensusFeedbackPayload =
      consensusPrimary && consensusPrimary.result != null ? consensusPrimary.result : consensusStageResults;
    const stage13Result = stage13SenioritySignalResults.length > 0 ? (stage13SenioritySignalResults[0].result as {
      target_seniority_level?: string;
      target_seniority_class?: SeniorityClass;
      candidate_seniority_class?: SeniorityClass;
      skill_representation_mode?: SkillRepresentationMode;
      experience_format?: ExperienceFormat;
    } | undefined) : undefined;
    const targetSeniorityFromStage13 =
      typeof stage13Result?.target_seniority_level === 'string' ? stage13Result.target_seniority_level : undefined;
    const skillRepresentationMode = inferSkillRepresentationMode({
      llmSkillRepresentationMode: stage13Result?.skill_representation_mode,
    });
    const experienceFormat = resolveExperienceFormat(stage13Result?.experience_format);

    return {
      structuredCV: JSON.stringify(this.candidateProfile.structured_cv, null, 2),
      consensus_feedback: JSON.stringify(consensusFeedbackPayload, null, 2),
      evidence_signals: evidenceSynthesiserResults.length > 0 ? JSON.stringify(evidenceSynthesiserResults[0].result, null, 2) : '{}',
      signal_layer: signalLayer ? JSON.stringify(signalLayer, null, 2) : '{}',
      seniority_signal_enforcement: stage13SenioritySignalResults.length > 0 ? JSON.stringify(stage13SenioritySignalResults[0].result, null, 2) : '{}',
      recruiter_reality_output: stage12RecruiterRealityResults.length > 0 ? JSON.stringify(stage12RecruiterRealityResults[0].result, null, 2) : '{}',
      skill_representation_mode: skillRepresentationMode,
      selected_missing_skills: this.candidateProfile.selected_missing_skills ? JSON.stringify(this.candidateProfile.selected_missing_skills) : '[]',
      target_role_title: this.candidateProfile.role_applying_for ?? '',
      target_role_seniority: targetSeniorityFromStage13 ?? this.candidateProfile.role_applying_for ?? '',
      target_seniority_class: stage13Result?.target_seniority_class ?? 'unknown',
      candidate_seniority_class: stage13Result?.candidate_seniority_class ?? 'unknown',
      experience_format: experienceFormat,
      previous_optimized_cv_hash: this.candidateProfile.previous_optimized_cv_hash ?? '',
    };
  }

  private setStage15AgentInputs(
    agent: AgentBuilder,
    waveResultsById: Record<string, unknown>,
    pipelineContext: Record<string, string>
  ): void {
    const inputs = agent.config.inputs;
    if (!inputs) return;
    const getAtPath = (obj: unknown, path: string): unknown => {
      if (obj == null) return undefined;
      const parts = path.split('.');
      let current: unknown = obj;
      for (const p of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[p];
      }
      return current;
    };

    for (const [key, ref] of Object.entries(inputs)) {
      if (ref === true) {
        const ctxVal = pipelineContext[key];
        if (ctxVal !== undefined) {
          agent.setInputData(key, ctxVal);
        } else if (key === 'structuredCV') {
          agent.setInputData(key, pipelineContext.structuredCV);
        }
        continue;
      }

      if (!ref || typeof ref !== 'object' || !('from' in ref)) continue;
      const from = (ref as AgentInputRef & { from: string }).from;
      const field = (ref as AgentInputRef & { field?: string }).field;

      if (from === 'input' && field && this.candidateProfile) {
        const val = field.startsWith('structuredCV.')
          ? getStructuredCvFieldForAgentInput(this.candidateProfile.structured_cv, field.replace(/^structuredCV\./, ''))
          : getAtPath(this.candidateProfile, field);
        agent.setInputData(key, typeof val === 'string' ? val : JSON.stringify(val ?? '', null, 2));
        continue;
      }

      if (from !== 'input') {
        const src = waveResultsById[from];
        if (src != null) {
          agent.setInputData(key, typeof src === 'string' ? src : JSON.stringify(src, null, 2));
        }
      }
    }
  }

  private getStage15DependencyWaves(agents: AgentBuilder[]): AgentBuilder[][] {
    const byId = new Map<string, AgentBuilder>();
    for (const agent of agents) byId.set(agent.config.id, agent);

    const dependencies = new Map<string, Set<string>>();
    for (const agent of agents) {
      const deps = new Set<string>();
      const inputs = agent.config.inputs ?? {};
      for (const ref of Object.values(inputs)) {
        if (ref && typeof ref === 'object' && 'from' in ref) {
          const from = (ref as AgentInputRef & { from: string }).from;
          if (from !== 'input' && from !== 'stage' && byId.has(from)) deps.add(from);
        }
      }
      dependencies.set(agent.config.id, deps);
    }

    const remaining = new Set(agents.map((agent) => agent.config.id));
    const waves: AgentBuilder[][] = [];
    while (remaining.size > 0) {
      const readyIds = Array.from(remaining).filter((id) => {
        const deps = dependencies.get(id) ?? new Set<string>();
        return Array.from(deps).every((dep) => !remaining.has(dep));
      });
      if (readyIds.length === 0) {
        throw new Error('stage_15_final_decision has circular or unresolved agent dependencies');
      }
      readyIds.sort();
      waves.push(readyIds.map((id) => byId.get(id)!).filter(Boolean));
      for (const id of readyIds) remaining.delete(id);
    }
    return waves;
  }

  private async runStage15FinalDecision(
    stage: PipelineStage,
    tracker: ExecutionTimeTracker,
    mainStageResults: StageResult[]
  ): Promise<AgentResult[]> {
    const mergeCombine = stage.mergeOutputs?.type === 'combine' ? (stage.mergeOutputs as MergeOutputsCombineConfig) : null;
    if (!mergeCombine) {
      const mergeType =
        stage.mergeOutputs != null && typeof stage.mergeOutputs === 'object' && 'type' in stage.mergeOutputs
          ? String((stage.mergeOutputs as { type?: unknown }).type)
          : 'missing';
      throw new Error(`stage_15_final_decision requires mergeOutputs.type "combine" (mergeOutputs.type=${mergeType})`);
    }

    const pipelineContext = this.buildStage15PipelineContext(mainStageResults);
    const waveResultsById: Record<string, unknown> = {};
    const allResults: AgentResult[] = [];
    const waves = this.getStage15DependencyWaves(stage.agents);

    for (const wave of waves) {
      for (const agent of wave) {
        this.setStage15AgentInputs(agent, waveResultsById, pipelineContext);
      }
      const waveResults = await this.runParallelAgents(wave, stage.id, stage.name, tracker);
      for (const result of waveResults) {
        if (result.success && result.result != null) {
          waveResultsById[result.agentId] = result.result;
        }
      }
      allResults.push(...waveResults);
    }

    const successful = allResults.filter((result) => result.success);
    let merged = mergeStage3Outputs(successful, mergeCombine, this.candidateProfile);
    const cvOptimizerInputData: Record<string, string> = {
      skill_representation_mode: pipelineContext.skill_representation_mode ?? 'keywords',
      selected_missing_skills: pipelineContext.selected_missing_skills ?? '[]',
      target_seniority_class: String(pipelineContext.target_seniority_class ?? 'unknown'),
      candidate_seniority_class: String(pipelineContext.candidate_seniority_class ?? 'unknown'),
      seniority_signal_enforcement: pipelineContext.seniority_signal_enforcement ?? '{}',
    };
    const postProcessed = cvOptimizationHandler.postProcessBeforeValidation?.(merged, {
      inputData: cvOptimizerInputData,
      candidateProfile: this.candidateProfile,
      config: stage.agents[0]?.config ?? ({} as import('../agents/agentConfig.js').AgentConfig),
      agentId: AGENT_MERGED,
      agentName: 'Merged',
      stageName: stage.name,
    });
    if (postProcessed != null) merged = postProcessed as typeof merged;
    allResults.push({ success: true, agentId: AGENT_MERGED, agentName: 'Merged', result: merged });

    Logger.info('PipelineRunner', 'Stage 15 CV optimization (dependency waves + merge) completed', {
      stageName: stage.name,
      waveCount: waves.length,
      agentCount: allResults.length - 1,
      merged: true,
    });
    return allResults;
  }

  private runComputedStage(stage: PipelineStage, mainStageResults: StageResult[]): StageResult | null {
    const handlers: Record<string, () => StageResult> = {
      stage_9_signal_confidence_aggregation: () => {
        const stageStart = Date.now();
        const aggregation = aggregateSignalConfidence(mainStageResults, 0);
        const runtimeMs = Date.now() - stageStart;
        return {
          stageId: 'stage_9_signal_confidence_aggregation',
          stageName: stage.name,
          results: [{
            success: true,
            agentId: 'signal_confidence_aggregation',
            agentName: 'Signal Confidence Aggregation',
            result: { ...aggregation, runtime_ms: runtimeMs },
          }],
        };
      },
    };

    const handler = handlers[stage.id];
    return handler ? handler() : null;
  }

  async runPipeline(context: RequestScopedContext): Promise<StageResult[]> {
    const pipelineStartTime = Date.now();
    Logger.logPipelineStart(this.stages.length);

    const tracker = context.tracker;

    // First group in parallelStageGroups: stages that run in parallel with the pipeline; we await and inject each
    // before the first main stage that depends on it (via inputs.previousStageResults).
    const pipelineParallelIds = this.pipelineParallelStageIds;
    const parallelPipelineStages = this.stages.filter(s => pipelineParallelIds.includes(s.id));
    const mainStages = this.stages.filter(s => !pipelineParallelIds.includes(s.id));

    const parallelPromises = new Map<string, { promise: Promise<StageResult>; startTime: number }>();
    for (const parallelStage of parallelPipelineStages) {
      parallelPromises.set(parallelStage.id, {
        promise: this.startParallelPipelineStage(parallelStage, tracker),
        startTime: Date.now(),
      });
    }

    const mainStageResults: StageResult[] = [];
    const injectedParallelStageIds = new Set<string>();

    for (let mainIndex = 0; mainIndex < mainStages.length; mainIndex++) {
      const stage = mainStages[mainIndex];
      const stageStartTime = Date.now();

      // Before the first main stage, await all parallel-pipeline stages so they complete before main execution.
      if (mainIndex === 0 && parallelPromises.size > 0) {
        const toAwait = Array.from(parallelPromises.entries());
        for (const [parallelStageId, entry] of toAwait) {
          const parallelStage = parallelPipelineStages.find(s => s.id === parallelStageId);
          if (!parallelStage || injectedParallelStageIds.has(parallelStageId)) continue;
          const stageResult = await this.awaitParallelStageWithTimeout(parallelStage, entry, tracker);
          mainStageResults.push(stageResult);
          injectedParallelStageIds.add(parallelStage.id);
          parallelPromises.delete(parallelStage.id);
        }
      }

      // Await and inject any parallel-pipeline stage that this main stage depends on and we haven't injected yet.
      for (const parallelStage of parallelPipelineStages) {
        if (injectedParallelStageIds.has(parallelStage.id)) continue;
        if (!PipelineRunner.stageDependsOn(stage, parallelStage.id)) continue;
        const entry = parallelPromises.get(parallelStage.id);
        if (!entry) continue;
        const stageResult = await this.awaitParallelStageWithTimeout(parallelStage, entry, tracker);
        mainStageResults.push(stageResult);
        injectedParallelStageIds.add(parallelStage.id);
        parallelPromises.delete(parallelStage.id);
      }

      const previousMainStage = mainIndex > 0 ? mainStages[mainIndex - 1] : null;
      const previousStageResult = previousMainStage ? mainStageResults.find(s => s.stageId === previousMainStage.id) : null;
      Logger.info('PipelineRunner', `Starting stage: ${stage.name}`, {
        stageIndex: mainIndex + 1,
        totalMainStages: mainStages.length,
        agentCount: stage.agents.length,
        agentNames: stage.agents.map(a => a.config.name),
        previousStageCompleted: previousStageResult?.stageName ?? 'N/A',
      });
      Logger.logStageStart(stage.name, stage.agents.length, stage.id);

      let previousStageResults: AgentResult[] = [];
      let previousStageId: string | undefined;
      let getStageResultsById: (stageId: string) => AgentResult[] = () => [];
      let getPreviousStageResultsRef: (agent: AgentBuilder) => PreviousStageResultsRef | undefined = () => undefined;
      let resolvePreviousStageResults: (
        ref: PreviousStageResultsRef,
        currentStageId: string,
        agentId: string
      ) => { payload: string } = () => ({ payload: '[]' });

      if (previousStageResult) {
        previousStageResults = previousStageResult.results;
        previousStageId = previousMainStage?.id;
        const successfulCount = previousStageResults.filter(r => r.success).length;

        if (stage.id === 'stage_14_consensus_decision' && (previousStageResults.length === 0 || successfulCount === 0)) {
          Logger.warn('PipelineRunner', `stage_14_consensus_decision received no successful prior-stage results; consensus input will be limited`, {
            stageName: stage.name,
            previousStage: previousStageResult.stageName,
            resultCount: previousStageResults.length,
            successfulCount,
          });
        }

        Logger.debug('PipelineRunner', `Passing previous stage results to ${stage.name}`, {
          previousStage: previousStageResult.stageName,
          resultCount: previousStageResults.length,
          jsonSize: JSON.stringify(previousStageResults, null, 2).length,
          previousStageSuccessCount: successfulCount,
        });
      }

      if (previousStageResult) {
        const getSignalNormalisationResults = (): AgentResult[] => {
          const stage4SignalNormResult = mainStageResults.find(s => s.stageId === 'stage_4_signal_normalisation');
          return stage4SignalNormResult ? stage4SignalNormResult.results.filter((r: AgentResult) => r.success) : [];
        };

        const getEvidenceSynthesiserResults = (): AgentResult[] => {
          const stage6EvidenceResult = mainStageResults.find(s => s.stageId === 'stage_6_evidence_synthesiser');
          return stage6EvidenceResult ? stage6EvidenceResult.results.filter((r: AgentResult) => r.success) : [];
        };

        getStageResultsById = (stageId: string): AgentResult[] => {
          const entry = mainStageResults.find(s => s.stageId === stageId);
          return entry ? entry.results.filter((r: AgentResult) => r.success) : [];
        };

        getPreviousStageResultsRef = (agent: AgentBuilder): PreviousStageResultsRef | undefined => {
          const fromInputs = agent.config.inputs?.previousStageResults;
          if (fromInputs && typeof fromInputs === 'object' && 'from' in fromInputs) {
            const r = fromInputs as PreviousStageResultsRef;
            if (r.from === 'stage' || r.from === 'composite') return r;
          }
          if (agent.config.inputFiles && 'previousStageResults' in agent.config.inputFiles && previousStageId) {
            return { from: 'stage', stageId: previousStageId };
          }
          return undefined;
        };

        const getAtPathForRef = (obj: unknown, path: string): unknown => {
          if (obj == null) return undefined;
          const parts = path.split('.');
          let current: unknown = obj;
          for (const p of parts) {
            if (current == null || typeof current !== 'object') return undefined;
            current = (current as Record<string, unknown>)[p];
          }
          return current;
        };

        const extractResultWithStageFields = (r: AgentResult, _stageId: string, paths: string | string[]): unknown => {
          if (typeof paths === 'string') {
            return getAtPathForRef(r, paths);
          }
          const out: Record<string, unknown> = {};
          for (const p of paths) {
            const key = p.split('.').pop() ?? p;
            out[key] = getAtPathForRef(r, p);
          }
          return out;
        };

        resolvePreviousStageResults = (
          ref: PreviousStageResultsRef,
          currentStageId: string,
          agentId: string
        ): { payload: string } => {
          if (ref.from === 'stage') {
            const results = getStageResultsById(ref.stageId);
            const toPass = results.length > 0 ? results : previousStageResults;
            if (ref.field && ref.field.trim()) {
              const trimmed = toPass.map((r: AgentResult) => ({
                agentId: r.agentId,
                agentName: r.agentName,
                success: r.success,
                result: getAtPathForRef(r, ref.field!),
              }));
              return { payload: JSON.stringify(trimmed, null, 2) };
            }
            return { payload: JSON.stringify(toPass, null, 2) };
          }

          if (ref.from === 'composite') {
            const stageIds = ref.stageIds ?? [];
            const isStage12SignalEvidence =
              currentStageId === 'stage_12_recruiter_reality_validator' &&
              agentId === 'recruiter_reality_validator' &&
              stageIds.length === 2 &&
              stageIds.includes('stage_4_signal_normalisation') &&
              stageIds.includes('stage_6_evidence_synthesiser');
            if (isStage12SignalEvidence) {
              const signalNormResults = getSignalNormalisationResults();
              const evidenceSynthesiserResults = getEvidenceSynthesiserResults();
              const signalNormalised = signalNormResults.length > 0 && signalNormResults[0].result != null ? signalNormResults[0].result : null;
              const evidenceSignals = evidenceSynthesiserResults.length > 0 && evidenceSynthesiserResults[0].result != null ? evidenceSynthesiserResults[0].result : null;
              const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
              const composite = JSON.stringify(
                {
                  signal_normalised: signalNormalised,
                  evidence_signals: evidenceSignals,
                  ...(signalLayer && {
                    signal_graph: signalLayer.signal_graph,
                    computed_score: signalLayer.computed_score,
                    inferred_seniority: signalLayer.inferred_seniority,
                    calibrated_signals: signalLayer.calibrated_signals,
                    evidence_items: signalLayer.evidence_items,
                    evidence_coverage_score: signalLayer.evidence_coverage_score,
                  }),
                },
                null,
                2
              );
              return { payload: composite };
            }
            const combined: AgentResult[] = [];
            const stageFields = ref.stageFields;
            for (const sid of stageIds) {
              const results = getStageResultsById(sid);
              const paths = stageFields?.[sid];
              if (paths !== undefined && paths !== null) {
                for (const r of results) {
                  combined.push({
                    agentId: r.agentId,
                    agentName: r.agentName,
                    success: r.success,
                    result: extractResultWithStageFields(r, sid, paths),
                  } as AgentResult);
                }
              } else {
                combined.push(...results);
              }
            }
            const toPass = combined.length > 0 ? combined : previousStageResults;
            return { payload: JSON.stringify(toPass, null, 2) };
          }

          return { payload: JSON.stringify(previousStageResults, null, 2) };
        }

        // Stage 14 consensus partial agents: set signal_layer and compact_signal_summary for all (some do not receive previousStageResults).
        if (stage.id === 'stage_14_consensus_decision') {
          const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
          const signalLayerForConsensus = signalLayer ? getSignalLayerPayloadWithoutEvidence(signalLayer) : null;
          const compactSignalSummary = buildCompactSignalSummary(mainStageResults, signalLayer);
          for (const agent of stage.agents) {
            if (agent.config.outputSchema && String(agent.config.outputSchema).startsWith('consensus_partial_')) {
              if (signalLayerForConsensus) {
                const signalLayerWithRewriteConstraints = {
                  ...signalLayerForConsensus,
                  rewrite_constraints: compactSignalSummary.rewrite_constraints,
                };
                agent.setInputData('signal_layer', JSON.stringify(signalLayerWithRewriteConstraints, null, 2));
              }
              agent.setInputData('compact_signal_summary', JSON.stringify(compactSignalSummary, null, 2));
            }
          }
        }

        for (const agent of stage.agents) {
          const ref = getPreviousStageResultsRef(agent);
          if (ref === undefined) continue;

          const resolved = resolvePreviousStageResults(ref, stage.id, agent.config.id);

          if (stage.id === 'stage_14_consensus_decision' && agent.config.outputSchema && String(agent.config.outputSchema).startsWith('consensus_partial_')) {
            agent.setInputData('previousStageResults', resolved.payload);
            Logger.debug('PipelineRunner', 'Set inputs for consensus-partial agent from config ref', {
              stageName: stage.name,
              agentName: agent.config.name,
              hasSignalLayer: true,
            });
            continue;
          }

          if (stage.id === 'stage_14_consensus_decision' && (agent.config.id === 'consensus_decision_maker' || agent.config.id === 'narrative_expander')) {
            if (agent.config.id === 'consensus_decision_maker') {
              const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
              const signalLayerForConsensus = signalLayer ? getSignalLayerPayloadWithoutEvidence(signalLayer) : null;
              const compactSignalSummary = buildCompactSignalSummary(mainStageResults, signalLayer);
              if (signalLayerForConsensus) {
                agent.setInputData('signal_layer', JSON.stringify(signalLayerForConsensus, null, 2));
              }
              agent.setInputData('compact_signal_summary', JSON.stringify(compactSignalSummary, null, 2));
              agent.setInputData('previousStageResults', resolved.payload);
              Logger.debug('PipelineRunner', 'Set previousStageResults for Consensus from config ref', {
                stageName: stage.name,
                hasSignalLayer: !!signalLayer,
              });
            }
            continue;
          }

          agent.setInputData('previousStageResults', resolved.payload);
          Logger.debug('PipelineRunner', `Set previousStageResults for ${agent.config.name} from config ref`, {
            agentName: agent.config.name,
            stageName: stage.name,
            dataSize: resolved.payload.length,
          });
        }
      }

      if (stage.id !== 'stage_15_final_decision' && this.candidateProfile) {
        this.injectInputRefsForAgents(stage.agents, mainStageResults);
      }

      // Run a parallel stage group when current stage is the first in a configured batch group (parallelStageGroups[1], [2], ...).
      const parallelGroup = this.batchStageGroups.find((g) => g[0] === stage.id);
      if (
        parallelGroup &&
        parallelGroup.length >= 2 &&
        mainIndex + parallelGroup.length <= mainStages.length &&
        parallelGroup.every((id, i) => mainStages[mainIndex + i]?.id === id)
      ) {
        const groupStages = parallelGroup.map((_, i) => mainStages[mainIndex + i]);
        const multiAgentStages = groupStages.filter((groupStage) => groupStage.agents.length !== 1);
        if (multiAgentStages.length > 0) {
          const stageIds = multiAgentStages.map((groupStage) => groupStage.id);
          const msg = `Parallel stage group requires exactly one agent per stage; invalid stages: ${stageIds.join(', ')}`;
          Logger.error('PipelineRunner', msg, undefined, { group: parallelGroup });
          throw new Error(msg);
        }
        const groupAgents = groupStages.map((s) => s.agents[0]).filter(Boolean);
        if (groupAgents.length !== parallelGroup.length) {
          Logger.warn('PipelineRunner', 'Parallel stage group has stage with no agent; running current stage only', {
            stageId: stage.id,
            group: parallelGroup,
          });
        } else {
          for (const groupStage of groupStages) {
            const agent = groupStage.agents[0];
            if (!agent) continue;
            const ref = getPreviousStageResultsRef(agent);
            if (ref) {
              const resolved = resolvePreviousStageResults(ref, groupStage.id, agent.config.id);
              agent.setInputData('previousStageResults', resolved.payload);
              Logger.debug('PipelineRunner', `Set previousStageResults for ${agent.config.name} (parallel group) from config ref`, {
                stageId: groupStage.id,
                agentName: agent.config.name,
              });
            } else {
              const stage4Results = mainStageResults[mainIndex - 1]?.results ?? [];
              agent.setInputData('previousStageResults', JSON.stringify(stage4Results, null, 2));
            }
          }

          const parallelBatchStart = Date.now();
          Logger.info('PipelineRunner', 'Running parallel stage group (all agents invoked concurrently)', {
            group: parallelGroup,
            stageNames: groupStages.map((s) => s.name),
            agentCount: groupAgents.length,
          });
          const allResults = await this.runParallelAgents(groupAgents, stage.id, stage.name, tracker);
          const parallelBatchEnd = Date.now();
          const parallelLatency = parallelBatchEnd - parallelBatchStart;

          Logger.info('PipelineRunner', `Parallel stage group completed in ${parallelLatency}ms (wall clock; stages ran concurrently, not sequentially)`, {
            group: parallelGroup,
            parallelLatencyMs: parallelLatency,
            successCount: allResults.filter((r) => r.success).length,
            failureCount: allResults.filter((r) => !r.success).length,
          });

          const resultByAgentId = new Map<string, AgentResult>(allResults.map((r) => [r.agentId, r]));
          for (const groupStage of groupStages) {
            const agentId = groupStage.agents[0]?.config.id;
            const singleResult = agentId != null ? resultByAgentId.get(agentId) : undefined;
            const resultsForStage = singleResult != null ? [singleResult] : [];
            mainStageResults.push({
              stageId: groupStage.id,
              stageName: groupStage.name,
              results: resultsForStage,
            });
            tracker.recordStage(groupStage.name, parallelBatchStart, parallelBatchEnd, groupStage.id);
            Logger.logStageComplete(groupStage.name, parallelLatency, resultsForStage.length, groupStage.id);
          }
          const anyFailure = allResults.some((r) => !r.success);
          if (anyFailure) {
            Logger.warn('PipelineRunner', 'Parallel stage group completed with some failures', {
              group: parallelGroup,
              successCount: allResults.filter((r) => r.success).length,
              failureCount: allResults.filter((r) => !r.success).length,
            });
          }
          mainIndex += parallelGroup.length - 1;
          continue;
        }
      }

      const computedStageStart = Date.now();
      const computedStageResult = stage.agents.length === 0 ? this.runComputedStage(stage, mainStageResults) : null;
      if (computedStageResult) {
        mainStageResults.push(computedStageResult);
        const computedLatency = Date.now() - computedStageStart;
        tracker.recordStage(stage.name, computedStageStart, Date.now(), stage.id);
        Logger.logStageComplete(stage.name, computedLatency, computedStageResult.results.length, stage.id);
        continue;
      }

      let results: AgentResult[];
      if (stage.id === 'stage_14_consensus_decision') {
        // Single consensus agent: run it, apply signal_blocks + signal_layer overlay onto the same AgentResult.
        const singleResults = await this.runParallelAgents(stage.agents, stage.id, stage.name, tracker);
        const consensusAgentResult = singleResults.find(
          (r: AgentResult) =>
            r.success &&
            r.result != null &&
            (r.agentId === CONSENSUS_DECISION_MAKER_ID || String(r.agentId).toLowerCase().includes('consensus'))
        );
        if (consensusAgentResult && consensusAgentResult.result != null && typeof consensusAgentResult.result === 'object') {
          const merged = { ...(consensusAgentResult.result as Record<string, unknown>) };
          const stage4SignalNorm = mainStageResults.find(s => s.stageId === 'stage_4_signal_normalisation');
          const signalNormSuccess = stage4SignalNorm?.results?.find((r: AgentResult) => r.success);
          if (signalNormSuccess) {
            merged.signal_blocks = getSignalBlocksFromSignalNormalisation(signalNormSuccess);
          }
          const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
          if (signalLayer) {
            merged.score = signalLayer.computed_score;
            merged.final_decision = signalLayer.final_decision;
            merged.decision = signalLayer.final_decision;
          }
          consensusAgentResult.result = merged;
        }
        results = singleResults;
      } else if (stage.id === 'stage_15_final_decision') {
        results = await this.runStage15FinalDecision(stage, tracker, mainStageResults);
      } else {
        Logger.debug('PipelineRunner', `Invoking ${stage.agents.length} agents in parallel for ${stage.name}`, {
          stageName: stage.name,
          agentNames: stage.agents.map(a => a.config.name),
        });
        results = await this.runParallelAgents(stage.agents, stage.id, stage.name, tracker);
      }

      Logger.debug('PipelineRunner', `All agents completed for ${stage.name}, response logs written`, {
        stageName: stage.name,
        resultCount: results.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        readyForNextStage: true,
      });
      Logger.info('PipelineRunner', `Completed stage: ${stage.name}`, {
        stageName: stage.name,
        resultCount: results.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
      });

      const stageEndTime = Date.now();
      const stageLatency = stageEndTime - stageStartTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      tracker.recordStage(stage.name, stageStartTime, stageEndTime, stage.id);
      Logger.logStageComplete(stage.name, stageLatency, results.length, stage.id);

      if (failureCount > 0) {
        Logger.warn('PipelineRunner', `Stage completed with some failures: ${stage.name}`, {
          successCount,
          failureCount,
          failedAgents: results.filter(r => !r.success).map(r => r.agentName),
        });
      }

      failFastOnQuotaInTest(stage.name, results);
      mainStageResults.push({ stageId: stage.id, stageName: stage.name, results });
    }

    const signalLayer = getSignalLayerPayload(mainStageResults, this.candidateProfile);
    const inputPayload = {
      structured_cv: this.candidateProfile.structured_cv,
      structured_job_description: this.candidateProfile.structured_job_description,
    };
    const auditLog = buildAuditLog(
      mainStageResults,
      this.candidateProfile?.email ?? undefined,
      {
        signalLayer: signalLayer
          ? {
              calibrated_signals: signalLayer.calibrated_signals,
              evidence_coverage_score: signalLayer.evidence_coverage_score,
              skill_representation_mode: signalLayer.skill_representation_mode,
            }
          : undefined,
        inputPayload,
        structuredCV: this.candidateProfile.structured_cv,
        jobDescription: this.candidateProfile.structured_job_description,
        pipelineVersion: process.env.PIPELINE_VERSION ?? undefined,
        modelVersions: {
          consensus: process.env.CONSENSUS_MODEL ?? 'unknown',
          cv_optimizer: process.env.CV_MODEL ?? 'unknown',
        },
        promptVersions: {
          consensus: '5.0.0',
          cv_optimizer: '3.5.0',
        },
      }
    );
    mainStageResults.push({
      stageId: STAGE_10_AUDIT_ID,
      stageName: 'Stage 10 - Audit Logging',
      results: [{ success: true, agentId: AGENT_AUDIT_LOGGER, agentName: 'Audit Logger', result: auditLog }],
    });

    // Parallel-pipeline stages (runInParallelWithPipeline) were already awaited and pushed when a main stage depended on them
    const stageResults: StageResult[] = mainStageResults;

    const pipelineLatency = Date.now() - pipelineStartTime;
    Logger.logPipelineComplete(pipelineLatency, this.stages.length);

    const stats = Logger.getStats();
    Logger.info('PipelineRunner', 'Pipeline execution summary', {
      totalStages: this.stages.length,
      totalResults: stageResults.reduce((sum, stage) => sum + stage.results.length, 0),
      stats,
    });

    return stageResults;
  }
}

