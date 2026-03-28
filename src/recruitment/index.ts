import { ConfigLoader } from './loaders/ConfigLoader.js';
import { PipelineRunner } from './pipeline/PipelineRunner.js';
import {
  CandidateProfile,
  CandidateProfileSchema,
  initializeOpenAI,
  getOpenAIConfig,
} from './agents/AgentBuilder.js';
import { Logger, LogLevel } from './utils/Logger.js';
import { pathToFileURL } from 'url';
import { parseRerunOptimizedCv } from './recruitment/parseRerunOptimizedCv.js';
import { runRecruitmentPreprocessing } from './recruitment/runRecruitmentPreprocessing.js';
import { structuredCvToProse } from './preprocessing/structuredCvToProse.js';
import { estimatePreprocessingTokens, estimateCostWithPreprocessing } from './utils/TokenEstimator.js';
import {
  aggregateTokenUsageByModel,
  resolvePipelineAgentModelName,
} from './utils/aggregateTokenUsageByModel.js';
import { resolvePreprocessingParams } from './preprocessing/PreprocessingAgent.js';
import { mergeSelectedMissingSkillsIntoStructuredCv } from './utils/mergeSelectedMissingSkillsIntoStructuredCv.js';
import type { StructuredCV } from './schemas/StructuredInputs.js';
import { getAuditLogFromResults, type AuditLog } from './logic/stage_10_audit_logging/auditLog.js';
import { ExecutionTimeTracker } from './utils/ExecutionTimeTracker.js';
import { getDisplayStages } from './displayStages.js';
import type { RequestScopedContext } from './requestScopedContext.js';
export { setOpenAiResourceProvider, type OpenAiResourceProvider } from './runtime/resourceProvider.js';

export { BACKEND_ONLY_STAGE_IDS, getDisplayStages } from './displayStages.js';

export type { RecruitmentRequest } from './recruitmentRequest.js';
import type { RecruitmentRequest } from './recruitmentRequest.js';

/** Context passed by the backend (API/Lambda) for tracing; required when calling main(). */
export interface RecruitmentRunContext {
  correlationToken: string;
  sessionToken?: string | null;
}

export type { RequestScopedContext } from './requestScopedContext.js';

export interface RecruitmentResponse {
  candidate: {
    name: string;
    email: string;
    company_name: string;
    role_applying_for: string;
    criticality_level: 'critical' | 'thorough' | 'objective' | 'lenient' | 'harsh' | 'easygoing' | 'constructive';
    verbosity_level: 'concise' | 'moderate' | 'detailed';
    cv_optimization_level: 'conservative' | 'moderate' | 'aggressive';
    audience_perspective: 'candidate' | 'hiring_organisation';
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
      error?: {
        message: string;
        code?: string;
        retryable?: boolean;
      };
    }>;
  }>;
  metadata: {
    executionTimeMs: number;
    totalStages: number;
    totalAgents: number;
    /** Correlation token for end-to-end tracing of this assessment run. */
    correlationToken: string;
    /** Session token (placeholder until sign-in); set at sign-in when implemented. */
    sessionToken?: string | null;
    tokenUsage?: {
      preprocessing?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
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
      perPipelineRun: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      perCandidate: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      /** Pipeline agents only: summed tokens per model id for one run. */
      perModelPipelineRun?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      /** Preprocessing + pipeline: summed tokens per model id for the full candidate run. */
      perModelPerCandidate?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
    };
  };
}

async function main(request: RecruitmentRequest, options: RecruitmentRunContext) {
  return Logger.runWithRequestContext(
    {
      correlationToken: options.correlationToken,
      sessionToken: options.sessionToken ?? null,
    },
    async () => {
  const mainStartTime = Date.now();
  let requestContext: RequestScopedContext | null = null;

  try {
  // Set log level from environment variable (default: INFO)
  const logLevel = (process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LogLevel) || 'INFO';
  Logger.setLogLevel(LogLevel[logLevel] ?? LogLevel.INFO);

  const rawVerbosity = (request.verbosity_level || 'moderate').toLowerCase().trim();
  const normalizedVerbosity: 'concise' | 'moderate' | 'detailed' = ['concise', 'moderate', 'detailed'].includes(rawVerbosity)
    ? (rawVerbosity as 'concise' | 'moderate' | 'detailed')
    : 'moderate';

  const rawCvOptimization = (request.cv_optimization_level || 'moderate').toLowerCase().trim();
  const normalizedCvOptimization: 'conservative' | 'moderate' | 'aggressive' = ['conservative', 'moderate', 'aggressive'].includes(rawCvOptimization)
    ? (rawCvOptimization as 'conservative' | 'moderate' | 'aggressive')
    : 'moderate';

  const rerunCvParse = parseRerunOptimizedCv(request);
  const hasEditedCvText =
    typeof request.edited_cv_text === 'string' && request.edited_cv_text.trim().length > 0;

  Logger.info('main', 'Starting recruitment pipeline', {
    candidateName: request.candidate_name,
    role: request.role_applying_for,
    company: request.company_name,
    criticalityLevel: request.criticality_level || 'objective',
    verbosityLevel: normalizedVerbosity,
    cvOptimizationLevel: normalizedCvOptimization,
    requestInputPath:
      request.is_rerun_with_updated_cv !== true
        ? 'file'
        : hasEditedCvText
          ? 'edited_cv_text'
          : rerunCvParse.status === 'valid'
            ? 'cv_extract_from_optimized_prose'
            : request.optimized_cv != null
              ? 'optimized_cv'
              : 'file',
    isRerunWithUpdatedCv: request.is_rerun_with_updated_cv === true,
    rerunCvSource: request.rerun_cv_source ?? null,
  });

  try {
    // Load configurations first (needed for preprocessing)
    const [agentsConfig, openaiConfig] = await Promise.all([
      ConfigLoader.loadAgentsConfig(),
      ConfigLoader.loadOpenAIConfig(),
    ]);
    const resolvedPreprocessingParams = resolvePreprocessingParams(
      agentsConfig.preprocessing,
      openaiConfig
    );

    Logger.info('main', 'Loaded agent configuration', {
      stageCount: agentsConfig.stages.length,
      totalAgents: agentsConfig.stages.reduce((sum, stage) => sum + stage.agents.length, 0),
      agentsJsonDefaultModel: agentsConfig.defaultModel?.name ?? null,
    });
    
    Logger.info('main', 'Loaded OpenAI configuration', {
      baseURL: openaiConfig.baseURL || 'https://api.openai.com/v1',
      hasApiKey: !!openaiConfig.apiKey,
      openaiDefaultModel: openaiConfig.defaultModel?.name ?? null,
      defaultTemperature: openaiConfig.defaultModel?.temperature ?? 0.7,
      defaultMaxTokens: openaiConfig.defaultModel?.maxTokens ?? 1000,
    });
    
    // Initialize OpenAI client with configuration (required for preprocessing)
    await initializeOpenAI(openaiConfig);

    // Generate runId with ms + correlation suffix so concurrent runs use distinct log folders
    const pipelineStartDate = new Date();
    const isoPart = pipelineStartDate.toISOString().split('.')[0].replace(/:/g, '-'); // YYYY-MM-DDTHH-MM-SS
    const ms = String(pipelineStartDate.getTime() % 1000).padStart(3, '0');
    const shortCorrelation = options.correlationToken.replace(/-/g, '').slice(0, 8);
    const runId = `${isoPart}-${ms}-${shortCorrelation}`;

    // Per-request execution time tracker (concurrent-safe)
    const tracker = new ExecutionTimeTracker();
    tracker.initialize(runId, mainStartTime);
    requestContext = {
      correlationToken: options.correlationToken,
      sessionToken: options.sessionToken ?? null,
      runId,
      tracker,
    };

    const { preprocessingResult } = await runRecruitmentPreprocessing(
      request,
      { runId: requestContext.runId, tracker: requestContext.tracker },
      rerunCvParse,
      resolvedPreprocessingParams
    );

    try {
      const validatedCV = preprocessingResult.structured_cv;
      const validatedJob = preprocessingResult.structured_job_description;
      Logger.debug('main', 'Structured data validated', {
        hasCV: !!validatedCV,
        hasJobRoleTitle: !!validatedJob?.role_title,
      });
    } catch (validationError) {
      Logger.error('main', 'Structured data validation failed', validationError as Error);
      throw new Error(`Structured data validation failed: ${(validationError as Error).message}`);
    }

    // Deterministically fold user-selected missing skills into structured CV before any pipeline stage.
    // Previously this only ran in Stage 15 post-process, so Stage 3 interviewers often saw unchanged skills
    // and returned identical scores on rerun.
    const selectedSkillsForCv =
      request.selected_missing_skills?.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0) ?? [];
    let structuredCvForPipeline: StructuredCV = preprocessingResult.structured_cv;
    if (selectedSkillsForCv.length > 0) {
      structuredCvForPipeline = JSON.parse(JSON.stringify(preprocessingResult.structured_cv)) as StructuredCV;
      const addedSkills = mergeSelectedMissingSkillsIntoStructuredCv(structuredCvForPipeline, selectedSkillsForCv);
      Logger.info('main', 'Merged selected_missing_skills into structured_cv before pipeline', {
        requestedCount: selectedSkillsForCv.length,
        addedCount: addedSkills.length,
        addedSkills,
      });
    }

    // Create CandidateProfile with structured data (not raw text)
    const jobPostedByRecruiter = request.job_posted_by_recruiter === true;
    const candidateProfile: CandidateProfile = {
      name: request.candidate_name,
      email: request.candidate_email,
      company_name: jobPostedByRecruiter ? '' : (request.company_name ?? ''),
      role_applying_for: request.role_applying_for,
      job_posted_by_recruiter: jobPostedByRecruiter,
      structured_cv: structuredCvForPipeline,
      structured_job_description: preprocessingResult.structured_job_description,
      criticality_level: (request.criticality_level?.toLowerCase().trim() || 'objective') as 'critical' | 'thorough' | 'objective' | 'lenient' | 'harsh' | 'easygoing' | 'constructive',
      verbosity_level: normalizedVerbosity,
      cv_optimization_level: normalizedCvOptimization,
      audience_perspective: request.audience_perspective?.toLowerCase().trim() === 'hiring_organisation' ? 'hiring_organisation' : 'candidate',
      is_rerun_with_updated_cv: request.is_rerun_with_updated_cv === true,
      cv_optimization_rerun_count: Math.max(0, Math.floor(Number(request.cv_optimization_rerun_count)) || 0),
      previous_run_scores: request.previous_run_scores && Object.keys(request.previous_run_scores).length > 0 ? request.previous_run_scores : undefined,
      previous_optimization_did_not_improve_scores: request.previous_optimization_did_not_improve_scores === true,
      previous_final_decision: request.previous_final_decision,
      previous_final_confidence: request.previous_final_confidence != null && request.previous_final_confidence >= 0 && request.previous_final_confidence <= 100 ? Math.floor(request.previous_final_confidence) : undefined,
      selected_missing_skills: request.selected_missing_skills && request.selected_missing_skills.length > 0 ? request.selected_missing_skills : undefined,
      previous_optimized_cv:
        request.is_rerun_with_updated_cv === true && request.optimized_cv != null
          ? request.optimized_cv
          : undefined,
      previous_optimized_cv_hash: request.previous_optimized_cv_hash?.trim() || undefined,
    };

    // Validate the candidate profile
    CandidateProfileSchema.parse(candidateProfile);
    Logger.debug('main', 'Candidate profile validated', {
      cvSize: request.file?.length ?? 0,
      jobDescriptionSize: request.job_description.length,
    });

    const pipeline = new PipelineRunner(agentsConfig.stages, candidateProfile, agentsConfig.parallelStageGroups);

    // Set runId for all agents so their logs are in the same directory as preprocessing logs
    const allAgents = pipeline['stages'].flatMap((stage: any) => stage.agents);
    const contextRunId = requestContext?.runId;
    if (contextRunId) {
      allAgents.forEach((agent: any) => agent.setRunId(contextRunId));
    }

    await pipeline.initAllAgents();

    // Get token estimates before running (includes preprocessing savings)
    const tokenEstimate = pipeline.estimateTokenUsage(1);
    
    const cvTextForPreprocTokens =
      (request.file?.length ?? 0) > 0
        ? request.file!
        : hasEditedCvText
          ? request.edited_cv_text!
          : rerunCvParse.status === 'valid'
            ? structuredCvToProse(rerunCvParse.structured, request.selected_missing_skills)
            : '';
    const preprocessingTokenEstimate = estimatePreprocessingTokens(
      cvTextForPreprocTokens,
      request.job_description
    );
    
    // Calculate total cost including preprocessing
    const openaiConfigForCost = getOpenAIConfig();
    const totalCostEstimate = estimateCostWithPreprocessing(
      tokenEstimate,
      preprocessingTokenEstimate,
      openaiConfigForCost.pricing
    );
    
    Logger.info('main', 'Token usage estimate (including preprocessing)', {
      preprocessing: {
        input: preprocessingTokenEstimate.inputTokens,
        output: preprocessingTokenEstimate.outputTokens,
        total: preprocessingTokenEstimate.totalTokens,
      },
      pipeline: {
        perAgent: tokenEstimate.perAgent.map(agent => ({
          name: agent.agentName,
          input: agent.inputTokens,
          output: agent.outputTokens,
          total: agent.totalTokens,
        })),
        perPipelineRun: {
          input: tokenEstimate.perPipelineRun.inputTokens,
          output: tokenEstimate.perPipelineRun.outputTokens,
          total: tokenEstimate.perPipelineRun.totalTokens,
        },
        perCandidate: {
          input: tokenEstimate.perCandidate.inputTokens,
          output: tokenEstimate.perCandidate.outputTokens,
          total: tokenEstimate.perCandidate.totalTokens,
        },
      },
      totalCost: totalCostEstimate.totalCost.toFixed(4),
      currency: totalCostEstimate.currency,
      costBreakdown: totalCostEstimate.breakdown,
    });
    
    const results = await pipeline.runPipeline(requestContext);

    const mainEndTime = Date.now();
    const totalLatency = mainEndTime - mainStartTime;
    
    // Record backend end time
    requestContext.tracker.recordBackendEnd(mainEndTime);
    
    // Token usage summary already logged above (including preprocessing)
    
    Logger.info('main', 'Pipeline completed successfully', {
      resultStageCount: results.length,
      totalResults: results.reduce((sum, stage) => sum + stage.results.length, 0),
    }, totalLatency);

    // Log final summary
    const stats = Logger.getStats();
    Logger.info('main', 'Final execution statistics', stats);

    // Build final structured response with all agent results
    const previousRunScores = candidateProfile.is_rerun_with_updated_cv === true && candidateProfile.previous_run_scores && Object.keys(candidateProfile.previous_run_scores).length > 0
      ? candidateProfile.previous_run_scores
      : null;

    const stageConfigById = new Map(
      agentsConfig.stages.map((stage) => [stage.id, stage])
    );

    // Normalise token usage from either API shape (camelCase, Completions prompt_tokens/completion_tokens, or Responses API input_tokens/output_tokens)
    type TokenUsageLike = {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
    const normaliseTokenUsage = (u: TokenUsageLike): { inputTokens: number; outputTokens: number; totalTokens: number } => {
      const input = u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0;
      const output = u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0;
      const total = u.totalTokens ?? u.total_tokens ?? input + output;
      return { inputTokens: input, outputTokens: output, totalTokens: total };
    };

    const openaiCfgForUsage = getOpenAIConfig();
    const preprocessingModelFallback = resolvedPreprocessingParams.model;

    // Build actual token usage from pipeline results when available (including per-stage)
    const actualPerAgent: Array<{
      name: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }> = [];
    const actualPerStage: Array<{ stageId: string; stageName: string; inputTokens: number; outputTokens: number; totalTokens: number }> = [];
    let actualPipelineRun = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const stageResult of results) {
      let stageUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      for (const agentResult of stageResult.results) {
        if (agentResult.tokenUsage) {
          const usage = normaliseTokenUsage(agentResult.tokenUsage as TokenUsageLike);
          const modelFromUsage = (agentResult.tokenUsage as { model?: string }).model;
          const resolvedModel =
            typeof modelFromUsage === 'string' && modelFromUsage.trim()
              ? modelFromUsage.trim()
              : resolvePipelineAgentModelName(agentsConfig, openaiCfgForUsage, agentResult.agentId);
          actualPerAgent.push({
            name: agentResult.agentName,
            model: resolvedModel,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          });
          stageUsage.inputTokens += usage.inputTokens;
          stageUsage.outputTokens += usage.outputTokens;
          stageUsage.totalTokens += usage.totalTokens;
          actualPipelineRun.inputTokens += usage.inputTokens;
          actualPipelineRun.outputTokens += usage.outputTokens;
          actualPipelineRun.totalTokens += usage.totalTokens;
        }
      }
      actualPerStage.push({
        stageId: stageResult.stageId,
        stageName: stageResult.stageName,
        inputTokens: stageUsage.inputTokens,
        outputTokens: stageUsage.outputTokens,
        totalTokens: stageUsage.totalTokens,
      });
    }
    const hasActualUsage = actualPerAgent.length > 0;
    const preprocessingActual = (preprocessingResult as { tokenUsage?: TokenUsageLike } | undefined)?.tokenUsage;
    const preprocessingUsageBase = preprocessingActual
      ? normaliseTokenUsage(preprocessingActual)
      : {
          inputTokens: preprocessingTokenEstimate.inputTokens,
          outputTokens: preprocessingTokenEstimate.outputTokens,
          totalTokens: preprocessingTokenEstimate.totalTokens,
        };
    const preprocessingUsage = {
      ...preprocessingUsageBase,
      model:
        preprocessingActual && typeof preprocessingActual.model === 'string' && preprocessingActual.model.trim()
          ? preprocessingActual.model.trim()
          : preprocessingModelFallback,
    };
    const pipelineRunUsage = hasActualUsage
      ? actualPipelineRun
      : {
          inputTokens: tokenEstimate.perPipelineRun.inputTokens,
          outputTokens: tokenEstimate.perPipelineRun.outputTokens,
          totalTokens: tokenEstimate.perPipelineRun.totalTokens,
        };
    const perAgentUsage = hasActualUsage
      ? actualPerAgent
      : tokenEstimate.perAgent.map(agent => ({
          name: agent.agentName,
          model: agent.model ?? 'unknown',
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          totalTokens: agent.totalTokens,
        }));

    const pipelineRowsForModel = hasActualUsage
      ? actualPerAgent.map(a => ({
          model: a.model,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          totalTokens: a.totalTokens,
        }))
      : tokenEstimate.perAgent.map(a => ({
          model: a.model ?? 'unknown',
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          totalTokens: a.totalTokens,
        }));
    const perModelPipelineRun = aggregateTokenUsageByModel(pipelineRowsForModel);
    const perModelPerCandidate = aggregateTokenUsageByModel([
      ...pipelineRowsForModel,
      {
        model: preprocessingUsage.model ?? preprocessingModelFallback,
        inputTokens: preprocessingUsage.inputTokens,
        outputTokens: preprocessingUsage.outputTokens,
        totalTokens: preprocessingUsage.totalTokens,
      },
    ]);

    // Per-stage usage: actual or derived from estimates (group perAgent by stage)
    const perStageUsage = hasActualUsage
      ? actualPerStage
      : (() => {
          const stageMap = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();
          let agentIndex = 0;
          for (const stage of agentsConfig.stages) {
            let inputTokens = 0, outputTokens = 0, totalTokens = 0;
            for (const _ of stage.agents ?? []) {
              const agent = tokenEstimate.perAgent[agentIndex++];
              if (agent) {
                inputTokens += agent.inputTokens;
                outputTokens += agent.outputTokens;
                totalTokens += agent.totalTokens;
              }
            }
            stageMap.set(stage.id, { inputTokens, outputTokens, totalTokens });
          }
          return agentsConfig.stages.map(s => ({
            stageId: s.id,
            stageName: s.name,
            ...(stageMap.get(s.id) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          }));
        })();

    const finalResponse: RecruitmentResponse = {
      candidate: {
        name: candidateProfile.name,
        email: candidateProfile.email,
        company_name: candidateProfile.company_name,
        role_applying_for: candidateProfile.role_applying_for,
        criticality_level: candidateProfile.criticality_level,
        verbosity_level: candidateProfile.verbosity_level,
        cv_optimization_level: candidateProfile.cv_optimization_level,
        audience_perspective: candidateProfile.audience_perspective,
        job_posted_by_recruiter: candidateProfile.job_posted_by_recruiter,
      },
      stages: results.map((stageResult, stageIndex) => {
        const stageConfig = stageConfigById.get(stageResult.stageId) ?? agentsConfig.stages[stageIndex];
        return {
          stageId: stageResult.stageId,
          stageName: stageResult.stageName,
          agents: stageResult.results.map((agentResult) => {
            const agentConfig = stageConfig?.agents?.find(a => a.id === agentResult.agentId);
            let result = agentResult.success ? agentResult.result : null;
            // Rerun: clamp interviewer scores so they never go below previous run (support both agentName and agentId keys for backward compat)
            const prevScore = previousRunScores != null ? (previousRunScores[agentResult.agentName] ?? previousRunScores[agentResult.agentId]) : undefined;
            if (previousRunScores && result != null && typeof result === 'object' && prevScore !== undefined) {
              const currentScore = (result as { score?: number }).score;
              if (typeof currentScore === 'number' && !Number.isNaN(currentScore) && currentScore < prevScore) {
                result = { ...(result as object), score: prevScore };
              }
            }
            return {
              agentId: agentResult.agentId,
              agentName: agentResult.agentName,
              outputSchema: agentConfig?.outputSchema || 'assessment',
              result,
              error: agentResult.success ? undefined : agentResult.error,
            };
          }),
        };
      }),
      metadata: {
        executionTimeMs: totalLatency,
        totalStages: 0, // set after filtering display stages
        totalAgents: 0, // set after filtering display stages
        correlationToken: options.correlationToken,
        sessionToken: options.sessionToken ?? undefined,
        tokenUsage: {
          preprocessing: {
            inputTokens: preprocessingUsage.inputTokens,
            outputTokens: preprocessingUsage.outputTokens,
            totalTokens: preprocessingUsage.totalTokens,
            model: preprocessingUsage.model,
          },
          perAgent: perAgentUsage,
          perStage: perStageUsage,
          perPipelineRun: pipelineRunUsage,
          perCandidate: {
            inputTokens: pipelineRunUsage.inputTokens + preprocessingUsage.inputTokens,
            outputTokens: pipelineRunUsage.outputTokens + preprocessingUsage.outputTokens,
            totalTokens: pipelineRunUsage.totalTokens + preprocessingUsage.totalTokens,
          },
          perModelPipelineRun,
          perModelPerCandidate,
        } as any, // Type assertion needed - preprocessing field is optional in interface but we always include it
      },
    };

    // Pipeline v2: do not expose Stage 2 and Stage 6 (backend-only stages) to frontend
    const displayStages = getDisplayStages(finalResponse.stages);
    finalResponse.stages = displayStages;
    finalResponse.metadata.totalStages = displayStages.length;
    finalResponse.metadata.totalAgents = displayStages.reduce((sum, s) => sum + s.agents.length, 0);

    // Rerun: prevent final decision from downgrading (e.g. previous hire -> new declined)
    const previousFinalDecision = candidateProfile.is_rerun_with_updated_cv === true ? candidateProfile.previous_final_decision : undefined;
    if (previousFinalDecision) {
      const order: Record<string, number> = { hire: 3, maybe: 2, declined: 1 };
      const prevOrd = order[previousFinalDecision] ?? 0;
      for (const stage of finalResponse.stages) {
        for (const agent of stage.agents) {
          if (String(agent.agentId ?? agent.agentName).toLowerCase().includes('consensus')) {
            const res = agent.result as { final_decision?: string } | null;
            if (res != null && typeof res === 'object' && typeof res.final_decision === 'string') {
              const newOrd = order[res.final_decision] ?? 0;
              if (newOrd < prevOrd) {
                (agent as { result: { final_decision: string } }).result = { ...res, final_decision: previousFinalDecision };
              }
            }
            break; // one Consensus agent per pipeline
          }
        }
      }
    }

    // Write execution time log file (include audit from Stage 10)
    try {
      const auditLog = getAuditLogFromResults(results);
      const logFilePath = await requestContext.tracker.writeLogFile(auditLog);
      Logger.info('main', 'Execution time log written', {
        filePath: logFilePath,
        runId: requestContext.runId,
      });
    } catch (error) {
      Logger.warn('main', 'Failed to write execution time log file', {
        error: (error as Error).message,
        runId: requestContext.runId,
      });
    }

    return finalResponse;
  } catch (error) {
    const mainEndTime = Date.now();
    const totalLatency = mainEndTime - mainStartTime;
    
    // Record backend end time even on error (if we have request-scoped tracker)
    if (requestContext?.tracker) {
      try {
        requestContext.tracker.recordBackendEnd(mainEndTime);
        // Write execution time log file even on error (minimal audit + pipeline_error for history)
        try {
          const minimalAudit: AuditLog = {
            audit_timestamp: new Date().toISOString(),
            ...(request.candidate_email ? { candidate_id: request.candidate_email } : {}),
            pipeline_error: (error as Error).message,
          };
          const logFilePath = await requestContext.tracker.writeLogFile(minimalAudit);
          Logger.info('main', 'Execution time log written (on error)', {
            filePath: logFilePath,
          });
        } catch (logError) {
          Logger.warn('main', 'Failed to write execution time log file on error', {
            error: (logError as Error).message,
          });
        }
      } catch (trackerError) {
        // Don't throw - tracker errors shouldn't mask the original error
        Logger.warn('main', 'Failed to record execution time on error', {
          error: (trackerError as Error).message,
        });
      }
    }
    
    Logger.error('main', 'Pipeline execution failed', error as Error, {
      totalLatency,
    });
    throw error;
  }
  } finally {
    Logger.clearRequestContext();
  }
    }
  );
}

// Example usage - in production, this would be called from an API endpoint
// with request object from the multipart/form-data request
// Check if this is the main module (ES module equivalent of require.main === module)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exampleRequest: RecruitmentRequest = {
    file: 'CV content here...',
    candidate_name: 'John Doe',
    candidate_email: 'john.doe@example.com',
    company_name: 'Tech Corp',
    role_applying_for: 'Senior Software Engineer',
    job_description: 'Job requirements here...',
    criticality_level: 'objective',
  };
  
  main(exampleRequest, { correlationToken: 'cli-run', sessionToken: null }).catch(console.error);
}

export { main };
export {
  buildAssessmentDisplayDocument,
  type AssessmentDisplayDocument,
  type RecruitmentResponseForDisplay,
} from './assessmentDisplayPayload.js';
// RecruitmentRequest and RecruitmentResponse are already exported as interfaces above
export { Logger, LogLevel } from './utils/Logger.js';
export type { LogEntry, AgentLogEntry } from './utils/Logger.js';
export { estimatePipelineTokens, estimateAgentTokens, estimateTokensFromText, estimateOutputTokens, estimateCost, estimatePreprocessingTokens, estimateCostWithPreprocessing } from './utils/TokenEstimator.js';
export type { TokenEstimate, AgentTokenEstimate, PipelineTokenEstimate } from './utils/TokenEstimator.js';
export { ConfigLoader } from './loaders/ConfigLoader.js';
export type {
  OpenAIConfig,
  AgentsConfig,
  AgentsDefaultModel,
  AgentsPreprocessingModel,
} from './loaders/ConfigLoader.js';
export type { ResolvedPreprocessingParams } from './preprocessing/PreprocessingAgent.js';
export { resolvePreprocessingParams, resolvePreprocessingModelName } from './preprocessing/PreprocessingAgent.js';
export { OPENAI_CONFIG_FILE_FALLBACK_MODEL_NAME } from './loaders/ConfigLoader.js';
export { testOpenAIConnection, validateOpenAIConfig } from './utils/OpenAIConnectionTest.js';
export type { ConnectionTestResult } from './utils/OpenAIConnectionTest.js';

