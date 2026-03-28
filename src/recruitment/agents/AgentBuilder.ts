import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import OpenAI from 'openai';
import { Logger } from '../utils/Logger.js';
import { constructPromptFilePath, extractVersionFromFilename, isValidVersion, parsePromptYamlToObject, replaceNewlinesInStrings } from '../utils/PromptVersion.js';
import { estimateAgentTokens, AgentTokenEstimate, OutputSchemaForEstimate } from '../utils/TokenEstimator.js';
import { ExecutionTimeTracker } from '../utils/ExecutionTimeTracker.js';
import { getAgentBuilderDir } from './agentBuilderDir.js';
import { getOpenAIClient, getOpenAIConfig } from './openaiClient.js';
import { writeLogFile } from './logging.js';
import { parseJsonFromModel } from './parsing.js';
import { normalizeAgentError } from './errors.js';
export { initializeOpenAI, getOpenAIClient, getOpenAIConfig } from './openaiClient.js';
export { writeLogFile } from './logging.js';
export { parseJsonFromModel } from './parsing.js';
export { AGENT_ERROR_CODES, type AgentErrorCode, normalizeAgentError } from './errors.js';

const _agentBuilderDir = getAgentBuilderDir();

/** Normalise API usage from either Completions (prompt_tokens/completion_tokens) or Responses API (input_tokens/output_tokens). */
type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};
function normaliseApiUsage(u: UsageLike): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const input = u.input_tokens ?? u.prompt_tokens ?? 0;
  const output = u.output_tokens ?? u.completion_tokens ?? 0;
  const total = u.total_tokens ?? (input + output || 0);
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

/** New signal per API call; `AbortSignal.timeout` stays aborted after it fires, so retries must not reuse one instance. */
function createResponsesAbortOptions(timeoutMs: number): { signal: AbortSignal } | undefined {
  return typeof AbortSignal?.timeout === 'function'
    ? { signal: AbortSignal.timeout(timeoutMs) }
    : undefined;
}

/** Inner API retry loop already called `Logger.logAgentError`; outer `catch` must not duplicate. */
const AGENT_INVOKE_API_ERROR_LOGGED = Symbol.for('recruiter.openai.agentInvokeApiErrorLogged');

import {
  AssessmentResultSchema,
  CareerGuidanceResultSchema,
  ConsensusResultSchema,
  CVOptimizationResultSchema,
  EvidenceSynthesiserSchema,
  FinalDecisionResultSchema,
  PanelWeightingSchema,
  RecruiterRealityValidationSchema,
  SenioritySignalEnforcementSchema,
  SignalNormalizedSchema,
  normalizeAssessmentScore,
} from './schemas/index.js';
import type { CandidateProfile } from './schemas/index.js';
import { getSchema, type OutputSchemaName } from './schemaRegistry.js';
import { getModelMaxOutputTokens, shouldApplyDefaultReasoningEffortNone } from '../utils/modelOutputTokenCaps.js';
import { normalizeStructuredListFields } from './normalizers/listFields.js';
import { loadCommonPromptFragments, INJECTED_PROMPT_KEY_TO_FRAGMENT } from './promptLoader.js';
import { getOpenAiResourceProvider } from '../runtime/resourceProvider.js';
import { getHandler } from './handlers/index.js';
import type { AgentTypeHandler } from './handlers/types.js';
import {
  getMetadataKeyExclusionsForAgent,
  isCvOptimizerAgent,
} from './agentKind.js';
import { buildResponsesJsonSchema } from './responsesApi/buildResponsesJsonSchema.js';

export {
  CandidateProfileSchema,
  InterviewQuestionSchema,
  HeadingSummarySchema,
  AssessmentResultSchema,
  CvRewriteStrategySchema,
  ConsensusResultSchema,
  CV_SECTION_HELP_KEYS,
  CVOptimizationResultSchema,
  InterviewFeedbackSummarySchema,
  CareerGuidanceResultSchema,
  FinalDecisionResultSchema,
  SignalNormalizedSchema,
  RecruiterRealityValidationSchema,
  EvidenceSynthesiserSchema,
  PanelWeightingSchema,
  AnomalyDetectionSchema,
  SenioritySignalEnforcementSchema,
  RecruitmentDecisionOutputSchema,
  normalizeAssessmentScore,
} from './schemas/index.js';

export type {
  HeadingSummary,
  CandidateProfile,
  InterviewQuestion,
  AssessmentResult,
  CVOptimizationResult,
  InterviewFeedbackSummary,
  CareerGuidanceResult,
  FinalDecisionResult,
  CvRewriteStrategy,
  ConsensusResult,
  SignalNormalized,
  RecruiterRealityValidation,
  EvidenceSynthesiser,
  PanelWeighting,
  SenioritySignalEnforcement,
  RecruitmentDecisionOutput,
  RichTextBlock,
  RichTextContent,
} from './schemas/index.js';

export type OutputSchema = 
  | typeof AssessmentResultSchema
  | typeof CVOptimizationResultSchema
  | typeof CareerGuidanceResultSchema
  | typeof FinalDecisionResultSchema
  | typeof ConsensusResultSchema
  | typeof SignalNormalizedSchema
  | typeof RecruiterRealityValidationSchema
  | typeof EvidenceSynthesiserSchema
  | typeof PanelWeightingSchema
  | typeof SenioritySignalEnforcementSchema;

export type { OutputSchemaName } from './schemaRegistry.js';

export { parseListLikeRichTextBlocks, normalizeStructuredListFields, narrativeToSummaryText } from './normalizers/listFields.js';
export { enforceResponsesJsonSchemaConstraints } from './normalizers/schemaConstraints.js';
export {
  reconcileOptimizedExperienceEntries,
  normalizeOptimizedCvForValidation,
  normalizeCvOptimizationResultForOutput,
  type ExperienceRepairResult,
} from './stage_15_final_decision/normalizer.js';
import type { AgentConfig } from './agentConfig.js';

export type { AgentConfig } from './agentConfig.js';

/** Result of invokeAgent: validated result plus optional API token usage. */
export interface InvokeAgentResult {
  result: unknown;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Model id used for this API call. */
    model: string;
  };
}

function resolveOutputSchemaName(raw: AgentConfig['outputSchema']): OutputSchemaName {
  if (raw == null) return 'assessment';
  const t = typeof raw === 'string' ? raw.trim() : '';
  return (t.length > 0 ? t : 'assessment') as OutputSchemaName;
}

export class AgentBuilder {
  private prompt = '';
  private inputData: Record<string, string> = {};
  private outputSchema: z.ZodSchema;
  private candidateProfile: CandidateProfile;
  private runId: string | null = null;
  /** Normalized from config (trimmed; default assessment) for schema, API json_schema name, and handlers. */
  private readonly resolvedOutputSchemaName: OutputSchemaName;
  /** Resolved once in constructor from outputSchema + id (used for prompt, input context, invoke). */
  private readonly resolvedHandler: AgentTypeHandler;

  constructor(public config: AgentConfig, candidateProfile: CandidateProfile) {
    this.candidateProfile = candidateProfile;

    this.resolvedOutputSchemaName = resolveOutputSchemaName(this.config.outputSchema);
    this.outputSchema = getSchema(this.resolvedOutputSchemaName);
    this.resolvedHandler = getHandler(this.resolvedOutputSchemaName, this.config.id);
  }

  async init() {
    const initStartTime = Date.now();
    
    // Validate version format
    if (!isValidVersion(this.config.version)) {
      throw new Error(`Invalid version format for ${this.config.name}: ${this.config.version}. Expected semver format (e.g., 1.0.0)`);
    }
    
    // Construct prompt file path with version
    const promptFileName = constructPromptFilePath(this.config.promptBase, this.config.version);
    const promptPath = path.resolve(_agentBuilderDir, '../../../prompts', promptFileName);
    
    Logger.debug('AgentBuilder', `Initializing agent: ${this.config.name}`, {
      agentName: this.config.name,
      promptBase: this.config.promptBase,
      version: this.config.version,
      promptFile: promptFileName,
      outputSchema: this.config.outputSchema,
      resolvedOutputSchemaName: this.resolvedOutputSchemaName,
    });

    // Load prompt file (YAML) as object for JSON prompt pipeline
    const fragments = await loadCommonPromptFragments(_agentBuilderDir);
    const handler = this.resolvedHandler;

    let promptObject: Record<string, unknown>;
    try {
      const provider = getOpenAiResourceProvider();
      const rawContent =
        (await provider?.getPromptText?.(promptFileName)) ??
        (await readFile(promptPath, 'utf-8'));
      const { metadata, promptObject: parsedObject } = parsePromptYamlToObject(rawContent);
      promptObject = { ...parsedObject };

      const filenameVersion = extractVersionFromFilename(promptFileName);
      if (filenameVersion && filenameVersion !== this.config.version) {
        Logger.warn('AgentBuilder', `Version mismatch between config and filename for ${this.config.name}`, {
          agentName: this.config.name,
          promptFile: promptFileName,
          configVersion: this.config.version,
          filenameVersion: filenameVersion,
        });
      }
      if (metadata.version && metadata.version !== this.config.version) {
        Logger.warn('AgentBuilder', `Version mismatch between config and YAML metadata for ${this.config.name}`, {
          agentName: this.config.name,
          configVersion: this.config.version,
          yamlVersion: metadata.version,
        });
      }

      if (this.config.promptInstructions) {
        promptObject.prompt_instructions = this.config.promptInstructions;
      }

      // Config-driven injection: add only the fragments listed in agents.json injectedPrompts
      const injectedPrompts = this.config.injectedPrompts;
      if (Array.isArray(injectedPrompts) && injectedPrompts.length > 0) {
        for (const configKey of injectedPrompts) {
          const fragmentKey = INJECTED_PROMPT_KEY_TO_FRAGMENT[configKey];
          if (fragmentKey && !(configKey in promptObject)) {
            const content = fragments[fragmentKey];
            if (typeof content === 'string' && content.trim()) {
              promptObject[configKey] = content.trim();
            }
          }
        }
      }

      const mergedPromptObject = handler.buildPromptObject(fragments, promptObject, this.config);

      const openaiConfig = getOpenAIConfig();
      const systemMessage =
        handler.resolveSystemMessage?.(this.config, openaiConfig.systemMessage) ??
        (openaiConfig.systemMessage ?? handler.getSystemMessage(this.config));
      mergedPromptObject.system = systemMessage;

      replaceNewlinesInStrings(mergedPromptObject);
      this.prompt = JSON.stringify(mergedPromptObject);

      Logger.debug('AgentBuilder', `Loaded prompt file: ${promptFileName}`, {
        agentName: this.config.name,
        promptPath: promptPath,
        promptSize: this.prompt.length,
        configVersion: this.config.version,
        filenameVersion: filenameVersion || 'unknown',
        promptKeys: Object.keys(mergedPromptObject),
      });
    } catch (error) {
      Logger.error('AgentBuilder', `Failed to load prompt file: ${promptFileName}`, error as Error, {
        agentName: this.config.name,
        promptPath,
        promptBase: this.config.promptBase,
        version: this.config.version,
      });
      throw error;
    }

    // Add candidate profile fields to input data
    this.inputData['name'] = this.candidateProfile.name;
    this.inputData['email'] = this.candidateProfile.email;
    this.inputData['company_name'] = this.candidateProfile.company_name;
    this.inputData['role_applying_for'] = this.candidateProfile.role_applying_for;
    this.inputData['criticality_level'] = this.candidateProfile.criticality_level;
    this.inputData['verbosity_level'] = this.candidateProfile.verbosity_level;
    const verbositySummary = fragments.verbositySummaries?.[this.candidateProfile.verbosity_level] ?? fragments.verbositySummaries?.moderate ?? '';
    if (verbositySummary) {
      this.inputData['verbosity_guidance'] = verbositySummary;
    }
    this.inputData['cv_optimization_level'] = this.candidateProfile.cv_optimization_level;
    this.inputData['audience_perspective'] = this.candidateProfile.audience_perspective;
    this.inputData['job_posted_by_recruiter'] = this.candidateProfile.job_posted_by_recruiter === true ? 'true' : 'false';
    this.inputData['is_rerun_with_updated_cv'] = this.candidateProfile.is_rerun_with_updated_cv === true ? 'true' : 'false';
    if (this.candidateProfile.cv_optimization_rerun_count != null) {
      this.inputData['cv_optimization_rerun_count'] = String(this.candidateProfile.cv_optimization_rerun_count);
    }
    if (this.candidateProfile.previous_run_scores && Object.keys(this.candidateProfile.previous_run_scores).length > 0) {
      this.inputData['previous_run_scores'] = JSON.stringify(this.candidateProfile.previous_run_scores);
    }
    if (this.candidateProfile.previous_optimization_did_not_improve_scores === true) {
      this.inputData['previous_optimization_did_not_improve_scores'] = 'true';
    }
    if (this.candidateProfile.previous_final_decision) {
      this.inputData['previous_final_decision'] = this.candidateProfile.previous_final_decision;
    }
    if (this.candidateProfile.previous_final_confidence != null) {
      this.inputData['previous_final_confidence'] = String(this.candidateProfile.previous_final_confidence);
    }
    if (this.candidateProfile.selected_missing_skills && this.candidateProfile.selected_missing_skills.length > 0) {
      this.inputData['selected_missing_skills'] = JSON.stringify(this.candidateProfile.selected_missing_skills);
    }
    if (this.candidateProfile.previous_optimized_cv_hash) {
      this.inputData['previous_optimized_cv_hash'] = this.candidateProfile.previous_optimized_cv_hash;
    }
    handler.enrichInputData?.(this.inputData, this.candidateProfile, this.config);

    const inputOpts = handler.getInputContextOptions?.(this.config);
    const excludeKeys = inputOpts?.excludeKeys ?? new Set<string>();
    const effectiveExcludeKeys = new Set(excludeKeys);
    if (this.config.excludeFullStructuredDocuments) {
      effectiveExcludeKeys.add('structuredCV');
      effectiveExcludeKeys.add('structuredJobDescription');
    }
    if (this.config.excludeFullStructuredCV) effectiveExcludeKeys.add('structuredCV');
    if (this.config.excludeFullStructuredJD) effectiveExcludeKeys.add('structuredJobDescription');
    if (!effectiveExcludeKeys.has('structuredCV')) {
      this.inputData['structuredCV'] = JSON.stringify(this.candidateProfile.structured_cv);
    }
    if (!effectiveExcludeKeys.has('structuredJobDescription')) {
      this.inputData['structuredJobDescription'] = JSON.stringify(this.candidateProfile.structured_job_description);
    }

    // Note: inputFiles.candidateCV and inputFiles.jobDescription are no longer used
    // Structured data is always required from CandidateProfile

    // Load other input files specified in config (e.g., previousStageResults)
    // Skip files that are already set in memory (e.g., by PipelineRunner)
    // Note: previousStageResults is always set by PipelineRunner in memory, so file loading is optional
    if (this.config.inputFiles) {
      const basePath = path.resolve(_agentBuilderDir, '../../../inputs');
      for (const [key, filePath] of Object.entries(this.config.inputFiles)) {
        if (filePath && key !== 'candidateCV' && key !== 'jobDescription') {
          // Skip if data is already set in memory (e.g., previousStageResults from PipelineRunner)
          if (this.inputData[key]) {
            Logger.debug('AgentBuilder', `Skipping file load for ${key} - already set in memory`, {
              agentName: this.config.name,
              key,
              dataSize: this.inputData[key].length,
            });
            continue;
          }
          
          // For previousStageResults, don't try to load from disk - it's always set by PipelineRunner
          // This prevents warnings when running in pipeline mode
          if (key === 'previousStageResults') {
            Logger.debug('AgentBuilder', `Skipping file load for ${key} - will be set by PipelineRunner`, {
              agentName: this.config.name,
              key,
            });
            continue;
          }
          
          try {
            const fullPath = path.resolve(basePath, filePath);
            this.inputData[key] = await readFile(fullPath, 'utf-8');
            Logger.debug('AgentBuilder', `Loaded input file: ${key}`, {
              agentName: this.config.name,
              filePath,
              size: this.inputData[key].length,
            });
          } catch (error) {
            Logger.warn('AgentBuilder', `Could not load input file: ${filePath}`, {
              agentName: this.config.name,
              key,
              error: (error as Error).message,
            });
          }
        }
      }
    }

    const initLatency = Date.now() - initStartTime;
    
    // Estimate tokens for this agent
    const inputContext = this.buildInputContext();
    // Performance optimization: Check inputData keys instead of searching string
    const isStructuredInput = 'structuredCV' in this.inputData || 'structuredJobDescription' in this.inputData;
    const tokenEstimate = estimateAgentTokens(
      this.config.name,
      this.prompt,
      inputContext,
      this.resolvedOutputSchemaName as OutputSchemaForEstimate,
      isStructuredInput
    );
    
    Logger.debug('AgentBuilder', `Initialized agent: ${this.config.name}`, {
      agentName: this.config.name,
      inputDataKeys: Object.keys(this.inputData),
      promptSize: this.prompt.length,
      initLatencyMs: initLatency,
      tokenEstimate: {
        input: tokenEstimate.inputTokens,
        output: tokenEstimate.outputTokens,
        total: tokenEstimate.totalTokens,
      },
    });
  }

  /**
   * Sets input data from memory (for passing previous stage results)
   */
  setInputData(key: string, value: string): void {
    this.inputData[key] = value;
    Logger.debug('AgentBuilder', `Set input data from memory: ${key}`, {
      agentName: this.config.name,
      size: value.length,
    });
  }

  /**
   * Sets the run ID for this pipeline run (ensures all logs go to the same folder)
   */
  setRunId(runId: string): void {
    this.runId = runId;
  }

  /**
   * Builds input context string (used for token estimation and actual invocation).
   * When previousStageResults is present, uses a defined key order so interviewer
   * assessments appear before the long CV/job docs (avoids model under-attending to them).
   */
  private buildInputContext(): string {
    if (Object.keys(this.inputData).length === 0) {
      return '';
    }

    const hasPreviousStageResults = 'previousStageResults' in this.inputData;
    const shortMetadataKeys = [
      'name',
      'email',
      'company_name',
      'role_applying_for',
      'criticality_level',
      'verbosity_level',
      'verbosity_guidance',
      'cv_optimization_level',
      'audience_perspective',
      'job_posted_by_recruiter',
      'is_rerun_with_updated_cv',
      'cv_optimization_rerun_count',
      'previous_run_scores',
      'previous_optimization_did_not_improve_scores',
      'previous_final_decision',
      'previous_final_confidence',
      'selected_missing_skills',
      'previous_optimized_cv_hash',
      'target_role_title',
      'target_role_seniority',
      'skill_representation_mode',
      'org_scope_metadata',
    ] as const;
    const longDocKeys = ['structuredCV', 'structuredJobDescription'] as const;
    /** When excludeFullStructuredDocuments: do not emit these candidate/PII metadata keys into the prompt. */
    const shortMetadataKeysExcludedWhenExcludingFullDocuments = new Set<string>([
      'name',
      'email',
      'company_name',
      'role_applying_for',
      'criticality_level',
      'audience_perspective',
      'job_posted_by_recruiter',
      'is_rerun_with_updated_cv',
      'cv_optimization_rerun_count',
      'previous_run_scores',
      'previous_optimization_did_not_improve_scores',
      'previous_final_decision',
      'previous_final_confidence',
      'previous_optimized_cv_hash',
    ]);
    const inputOpts = this.resolvedHandler.getInputContextOptions?.(this.config) ?? { excludeKeys: new Set<string>() };
    const excludeKeysForBackground = inputOpts.excludeKeys;
    const excludeMetadataKeys =
      inputOpts.excludeMetadataKeys ?? getMetadataKeyExclusionsForAgent(this.config);

    const shouldExclude = (key: string) =>
      excludeKeysForBackground.has(key) ||
      excludeMetadataKeys.has(key) ||
      (this.config.excludeFullStructuredDocuments === true && (key === 'structuredCV' || key === 'structuredJobDescription')) ||
      (this.config.excludeFullStructuredDocuments === true && shortMetadataKeysExcludedWhenExcludingFullDocuments.has(key)) ||
      (key === 'structuredCV' && this.config.excludeFullStructuredCV === true) ||
      (key === 'structuredJobDescription' && this.config.excludeFullStructuredJD === true);

    const inputObj: Record<string, string> = {};

    if (hasPreviousStageResults && this.config.inputOnlyPreviousStageResults === true) {
      if ('previousStageResults' in this.inputData) {
        inputObj['previousStageResults'] = this.inputData['previousStageResults'];
      }
    } else if (hasPreviousStageResults) {
      for (const key of shortMetadataKeys) {
        if (key in this.inputData && !shouldExclude(key)) {
          inputObj[key] = this.inputData[key];
        }
      }
      if ('previousStageResults' in this.inputData) {
        inputObj['previousStageResults'] = this.inputData['previousStageResults'];
      }
      for (const key of longDocKeys) {
        if (key in this.inputData && !shouldExclude(key)) {
          inputObj[key] = this.inputData[key];
        }
      }
      const orderedKeys = new Set([...shortMetadataKeys, 'previousStageResults', ...longDocKeys]);
      for (const [key, content] of Object.entries(this.inputData)) {
        if (!orderedKeys.has(key as any) && !shouldExclude(key)) {
          inputObj[key] = content;
        }
      }
    } else {
      for (const [key, content] of Object.entries(this.inputData)) {
        if (!shouldExclude(key)) {
          inputObj[key] = content;
        }
      }
    }

    if (this.candidateProfile.job_posted_by_recruiter === true) {
      inputObj['_recruiter_note'] =
        'The job is advertised by a recruiter; the hiring company is unknown. Do not tailor feedback or research to any company; focus only on the role and job description.';
    }

    const newlineRe = /\r\n|\r|\n/g;
    for (const key of Object.keys(inputObj)) {
      const s = inputObj[key];
      inputObj[key] = s.replace(newlineRe, ' ').replace(/\s{2,}/g, ' ');
    }
    return JSON.stringify(inputObj);
  }

  /**
   * Determines if an error is retryable (transient errors that might succeed on retry)
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code || (error as any).status || '';

    // Quota exceeded is not retryable (billing/plan limit)
    if (errorCode === 'insufficient_quota' || errorMessage.includes('exceeded your current quota')) {
      return false;
    }

    // Rate limit errors (429) - transient rate limit, not quota
    if (errorCode === 429 || errorMessage.includes('rate limit')) {
      return true;
    }
    
    // Timeout errors (ETIMEDOUT, or message contains timeout/timed out)
    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return true;
    }
    // AbortError from AbortSignal.timeout() - message is often "Request was aborted." with no "timeout" in it
    const errorName = (error as any).name || '';
    if (errorName === 'AbortError' || errorMessage.includes('abort')) {
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

  /**
   * Estimates token usage for this agent
   */
  estimateTokens(): AgentTokenEstimate {
    const inputContext = this.buildInputContext();
    // Performance optimization: Check inputData keys instead of searching string
    const isStructuredInput = 'structuredCV' in this.inputData || 'structuredJobDescription' in this.inputData;
    const base = estimateAgentTokens(
      this.config.name,
      this.prompt,
      inputContext,
      this.resolvedOutputSchemaName as OutputSchemaForEstimate,
      isStructuredInput
    );
    const openaiCfg = getOpenAIConfig();
    const model = this.config.modelParams?.model ?? openaiCfg.defaultModel?.name;
    return model ? { ...base, model } : base;
  }

  /** Token usage from the API (input = prompt, output = completion). */
  async invokeAgent(stageId: string, stageName: string, tracker?: ExecutionTimeTracker): Promise<InvokeAgentResult> {
    const invokeStartTime = Date.now();
    const agentName = this.config.name;
    const agentId = this.config.id;
    const resolvedTracker = tracker ?? ExecutionTimeTracker.getInstance();

    if (!this.prompt) {
      const error = new Error('Prompt not loaded');
      Logger.logAgentError(agentName, error, stageName, undefined, agentId, stageId);
      throw error;
    }

    Logger.logAgentStart(agentName, stageName, {
      inputDataKeys: Object.keys(this.inputData),
      promptSize: this.prompt.length,
      modelParams: this.config.modelParams,
    }, agentId, stageId);

    // Build input context from loaded files
    const inputContext = this.buildInputContext();
    const totalInputSize = (this.prompt + inputContext).length;
    
    // Estimate tokens for logging
    const tokenEstimate = this.estimateTokens();
    const config = getOpenAIConfig();
    // Get raw model name (may be mixed case) and normalize for internal checks
    const rawModelName = this.config.modelParams?.model ?? config.defaultModel?.name;
    if (!rawModelName || typeof rawModelName !== 'string' || rawModelName.trim() === '') {
      throw new Error(
        'No LLM model configured for this agent. Set agents.json `defaultModel.name`, openai.json `defaultModel.name`, or agent `modelParams.model`.'
      );
    }
    const modelName = rawModelName.toLowerCase(); // Normalize for internal checks (token limits)
    const apiModelName = rawModelName; // Keep original for API call (API may be case-sensitive)
    const reasoningEffort = this.config.modelParams?.reasoning?.effort;
    
    // Log model name for debugging
    Logger.debug('AgentBuilder', `Model configuration`, {
      agentName,
      modelName: apiModelName, // Log original name
      normalizedModelName: modelName, // Log normalized for debugging
      fromConfig: this.config.modelParams?.model ?? 'agents.json default / openai default',
      defaultModel: config.defaultModel?.name,
    });
    
    // Clamp max_output_tokens to model limits to prevent API errors
    // Responses API uses max_output_tokens instead of max_tokens
    const modelLimit = getModelMaxOutputTokens(modelName);
    
    // Use the model's maximum if max_output_tokens not specified, otherwise use specified value
    let maxOutputTokens = this.config.modelParams?.max_tokens ?? config.defaultModel?.maxTokens;
    if (maxOutputTokens === undefined) {
      // Default to model's maximum if not specified
      maxOutputTokens = modelLimit;
    }
    
    // Clamp to model limit if exceeds
    if (maxOutputTokens > modelLimit) {
      Logger.warn('AgentBuilder', `max_output_tokens (${maxOutputTokens}) exceeds model limit (${modelLimit}), clamping to ${modelLimit}`, {
        agentName,
        modelName,
        requestedMaxOutputTokens: maxOutputTokens,
        modelLimit,
      });
      maxOutputTokens = modelLimit;
    }
    
    Logger.debug('AgentBuilder', `Invoking OpenAI Responses API`, {
      agentName,
      stageName,
      inputSize: totalInputSize,
      estimatedTokens: {
        input: tokenEstimate.inputTokens,
        output: tokenEstimate.outputTokens,
        total: tokenEstimate.totalTokens,
      },
      model: apiModelName, // Use original model name for logging
      maxOutputTokens,
    });

    // Per-agent timeout (ms): used for every Responses API call (retries and re-calls get a fresh AbortSignal each time)
    const timeoutMs = this.config.timeout ?? config.timeout ?? 180000;

    const handler = this.resolvedHandler;

    // Instructions = single well-formed JSON string (includes system and all prompt keys)
    const instructions = this.prompt;
    
    // Input = the actual data (CV, job description, etc.)
    // Ensure JSON is mentioned in input when using text.format
    let input =
      inputContext ||
      (handler.getEmptyUserInputFallback?.(this.config) ?? 'Please provide your assessment.');
    if (!input.includes('JSON') && !input.includes('json')) {
      input = input + ' IMPORTANT: Respond with valid JSON only.';
    }

    let response: any;
    let apiLatency: number = 0;
    let requestParams: any;
    let client: OpenAI;

    // Declare request logging variables outside try block so they're accessible in catch and later
    let requestMetadata: Record<string, any> = {};
    let requestParamsForLog: Record<string, unknown> | null = null;

    try {
      client = getOpenAIClient();
      if (!client?.responses?.create) {
        throw new Error(
          'OpenAI client does not have responses.create. Ensure the openai package supports the Responses API (e.g. openai@4.52+). Call initializeOpenAI() with a valid config so the default client is used.'
        );
      }

      const schemaName = this.resolvedOutputSchemaName;
      const { jsonSchema, useStrictMode } = buildResponsesJsonSchema({
        zodSchema: this.outputSchema,
        schemaName,
        agentName,
        stageName,
        config: this.config,
      });

      
      requestParams = {
        model: apiModelName, // Use original model name for API call
        input: input,
        instructions: instructions,
        text: {
          format: {
            type: "json_schema",
            name: schemaName, // Required by Responses API - must match schema $id or title
            schema: jsonSchema,
            strict: useStrictMode
          }
        },
        max_output_tokens: maxOutputTokens,
        stream: false, // Explicit non-streaming so SDK/API never use streaming path (avoids hang with tools + json_schema).
      };
      
      const responsesTools = handler.getResponsesTools?.(this.config);
      if (responsesTools && responsesTools.length > 0) {
        requestParams.tools = responsesTools;
      }
      
      // Pass through per-agent reasoning settings from config when provided.
      if (reasoningEffort) {
        requestParams.reasoning = { effort: reasoningEffort };
      }
      // Keep gpt-5.2/gpt-5.4 fallback only when a config effort is not set.
      if (!requestParams.reasoning && shouldApplyDefaultReasoningEffortNone(modelName)) {
        requestParams.reasoning = { effort: 'none' };
      }

      // Snapshot exactly what we pass to the SDK (avoid logging any fields the SDK may add later)
      requestParamsForLog = JSON.parse(JSON.stringify(requestParams)) as Record<string, unknown>;

      Logger.debug('AgentBuilder', `Responses API request parameters configured`, {
        agentName,
        modelName: apiModelName, // Use original model name for logging
        normalizedModelName: modelName,
        maxOutputTokens,
        reasoningEffort: requestParams.reasoning?.effort,
        instructionsLength: instructions.length,
        inputLength: input.length,
        responseFormat: 'json_schema',
        strictMode: useStrictMode,
        schemaName: schemaName, // Log the schema name being used
        textFormat: JSON.stringify(requestParams.text), // Log the actual text.format object
      });
      
      requestMetadata = {
        model: apiModelName, // Use original model name for logging
        reasoningEffort: requestParams.reasoning?.effort,
        maxOutputTokens,
        responseFormat: 'json_schema',
        strictMode: useStrictMode,
        estimatedTokens: {
          input: tokenEstimate.inputTokens,
          output: tokenEstimate.outputTokens,
          total: tokenEstimate.totalTokens,
        },
      };

      // Persist the exact outbound payload before any API attempt so failures still have a request artifact.
      if (requestParamsForLog != null || Object.keys(requestMetadata).length > 0) {
        await writeLogFile(
          '',
          agentName,
          stageName,
          'request',
          this.runId,
          requestMetadata,
          requestParamsForLog ?? undefined,
          agentId,
          stageId
        );
      }

      // Retry logic for transient errors
      const maxRetries = 3;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const attemptStartTime = Date.now();
        const requestOptionsForAttempt = createResponsesAbortOptions(timeoutMs);
        try {
          Logger.debug('AgentBuilder', `Calling OpenAI Responses API (attempt ${attempt}/${maxRetries})`, {
            agentName,
            stageName,
          });

          Logger.debug('AgentBuilder', `Making Responses API call`, {
            agentName,
            attempt,
            hasTextFormat: !!requestParams.text?.format,
            formatName: requestParams.text?.format?.name,
            formatType: requestParams.text?.format?.type,
            hasSchema: !!requestParams.text?.format?.schema,
          });

          const apiCallPromise = requestOptionsForAttempt
            ? (client as any).responses.create(requestParams, requestOptionsForAttempt)
            : (client as any).responses.create(requestParams);
          const waitStart = Date.now();
          const waitInterval = setInterval(() => {
            const elapsedSec = Math.round((Date.now() - waitStart) / 1000);
            console.log(`${agentName}: still waiting (${elapsedSec}s)`);
          }, 45000);
          try {
            response = await apiCallPromise;
          } finally {
            clearInterval(waitInterval);
          }
          const attemptEndTime = Date.now();
          apiLatency = attemptEndTime - attemptStartTime;
          
          // Record successful API request timing
          resolvedTracker.recordOpenAIRequest(
            agentName,
            'agent',
            apiModelName,
            attemptStartTime,
            attemptEndTime,
            true,
            stageName,
            attempt,
            undefined,
            agentId,
            stageId
          );
          
          Logger.debug('AgentBuilder', `OpenAI Responses API response received`, {
            agentName,
            stageName,
            apiLatency,
            attempt,
            tokenUsage: response.usage,
          });
          
          // Success - break out of retry loop
          break;
        } catch (error) {
          lastError = error as Error;
          const attemptEndTime = Date.now();
          const isRetryable = this.isRetryableError(lastError);
          const apiLatency = attemptEndTime - attemptStartTime;
          
          // Record failed API request timing
          resolvedTracker.recordOpenAIRequest(
            agentName,
            'agent',
            apiModelName,
            attemptStartTime,
            attemptEndTime,
            false,
            stageName,
            attempt,
            lastError.message,
            agentId,
            stageId
          );
          
          // Log the error
          Logger.logAgentError(agentName, lastError, stageName, {
            apiLatency,
            attempt,
            maxRetries,
            retryable: isRetryable,
            modelParams: this.config.modelParams,
          }, agentId, stageId);
          
          // If not retryable or we've exhausted retries, throw
          if (!isRetryable || attempt >= maxRetries) {
            (lastError as Error & { [AGENT_INVOKE_API_ERROR_LOGGED]?: true })[AGENT_INVOKE_API_ERROR_LOGGED] = true;
            throw lastError;
          }
          
          // Calculate exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          Logger.warn('AgentBuilder', `Retrying after ${backoffMs}ms (attempt ${attempt}/${maxRetries})`, {
            agentName,
            stageName,
            error: lastError.message,
          });
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
      
      // If we get here without a response, something went wrong
      if (!response) {
        throw lastError || new Error('Failed to get response from OpenAI Responses API');
      }
      
      // Debug: Log the response structure to understand the format
      Logger.debug('AgentBuilder', `OpenAI Responses API response structure`, {
        agentName,
        stageName,
        hasOutput: !!response.output,
        outputType: typeof response.output,
        isArray: Array.isArray(response.output),
        outputKeys: response.output && typeof response.output === 'object' && !Array.isArray(response.output) ? Object.keys(response.output) : null,
        responseKeys: Object.keys(response),
        outputPreview: typeof response.output === 'string' ? response.output.substring(0, 200) : 
                      Array.isArray(response.output) ? `Array[${response.output.length}]` : 
                      typeof response.output === 'object' ? JSON.stringify(response.output).substring(0, 200) : response.output,
      });
    } catch (error) {
      // Final error handling - this will be caught by Promise.allSettled in PipelineRunner
      const apiLatency = Date.now() - invokeStartTime;
      const errorObj = error as Error;
      const { code: normalizedCode, retryable: normalizedRetryable } = normalizeAgentError(errorObj);
      (errorObj as any).code = normalizedCode;
      (errorObj as any).retryable = normalizedRetryable;
      const apiErrorAlreadyLogged =
        (errorObj as Error & { [AGENT_INVOKE_API_ERROR_LOGGED]?: true })[AGENT_INVOKE_API_ERROR_LOGGED] === true;
      if (!apiErrorAlreadyLogged) {
        Logger.logAgentError(agentName, errorObj, stageName, {
          apiLatency,
          modelParams: this.config.modelParams,
        }, agentId, stageId);
      }
      
      // Log error response to file so we have a record of what happened
      // This ensures proper sequencing: error responses are logged before next stage requests
      try {
        const errorResponse = {
          error: true,
          errorMessage: errorObj.message,
          errorCode: normalizedCode,
          retryable: normalizedRetryable,
          apiLatency,
          timestamp: new Date().toISOString(),
        };
        
        // Log error response (non-blocking)
        writeLogFile(
          JSON.stringify(errorResponse, null, 2),
          agentName,
          stageName,
          'response',
          this.runId,
          {
            error: true,
            errorCode: errorResponse.errorCode,
            retryable: errorResponse.retryable,
            durationMs: apiLatency,
            apiLatency,
          },
          undefined,
          agentId,
          stageId
        ).catch(logError => {
          Logger.warn('AgentBuilder', `Failed to log error response`, {
            agentName,
            stageName,
            error: (logError as Error).message,
          });
        });
      } catch (logError) {
        // Don't throw - logging failures shouldn't break error handling
        Logger.warn('AgentBuilder', `Failed to prepare error log`, {
          agentName,
          stageName,
          error: (logError as Error).message,
        });
      }
      
      throw error;
    }

    // Check for truncation BEFORE parsing (in case truncation causes JSON parse errors)
    const finishReason = response.finish_reason;
    if (finishReason === 'length' || finishReason === 'max_tokens') {
      const error = new Error(`Response was truncated due to max_output_tokens limit (${maxOutputTokens}). Consider increasing max_output_tokens for ${agentName}.`);
      (error as any).code = 'TRUNCATED_RESPONSE';
      (error as any).retryable = true;
      Logger.logAgentError(agentName, error, stageName, {
        finishReason,
        maxOutputTokens,
        responseSize: typeof response.output === 'string' ? response.output.length : JSON.stringify(response.output).length,
      }, agentId, stageId);
      throw error;
    }

    // Responses API with response_format returns structured data directly
    // response.output should be the structured object matching our schema
    let parsed: unknown;
    let parseAttempt = 1;
    const maxParseAttempts = 3; // Initial parse + up to two fresh API re-calls for malformed JSON
    let validationAttempt = 1;
    const maxValidationAttempts = 3; // Retry with fresh API call when Zod schema validation fails

    while (validationAttempt <= maxValidationAttempts) {
      parseAttempt = 1;

    while (true) {
    try {
      // Simple extraction - Responses API should return structured data
      if (typeof response.output === 'object' && !Array.isArray(response.output) && response.output !== null) {
        const raw = response.output as Record<string, unknown>;
        const keys = Object.keys(raw);
        const allNumericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
        const allStringValues = keys.every((k) => typeof raw[k] === 'string');
        if (allNumericKeys && allStringValues) {
          const reassembled = keys
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => raw[k] as string)
            .join('');
          parsed = parseJsonFromModel(reassembled);
        } else {
          parsed = response.output;
        }
        const outputKeys = Object.keys(parsed as object);
        Logger.debug('AgentBuilder', `Using response.output directly as object`, {
          agentName,
          stageName,
          outputKeys,
        });
        
        // CRITICAL: For CV Optimizer, verify optimized_cv is present in response
        if (this.resolvedOutputSchemaName === 'cv_optimization') {
          const hasOptimizedCv = outputKeys.includes('optimized_cv');
          Logger.warn('AgentBuilder', `CV Optimizer response verification`, {
            agentName,
            stageName,
            hasOptimizedCv,
            outputKeys,
            optimizedCvPresent: hasOptimizedCv,
            responsePreview: JSON.stringify(parsed).substring(0, 500),
          });
          
          if (!hasOptimizedCv) {
            Logger.error('AgentBuilder', `CRITICAL: optimized_cv is missing from API response!`, undefined, {
              agentName,
              stageName,
              outputKeys,
              responseKeys: outputKeys,
            });
          }
        }
      } else if (typeof response.output === 'string') {
        // Parse JSON string (with repair for common model output issues)
        parsed = parseJsonFromModel(response.output);
        Logger.debug('AgentBuilder', `Parsed response.output as JSON string`, {
          agentName,
          stageName,
          parsedKeys: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.keys(parsed as object) : [],
        });
      } else if (Array.isArray(response.output)) {
        // Array response structure - extract structured data from message
        Logger.debug('AgentBuilder', `Processing array response.output`, {
          agentName,
          stageName,
          arrayLength: response.output.length,
        });
        
        // Find the message object
        const messageObj = response.output.find((item: any) => 
          item.type === 'message' && (item.status === 'completed' || !item.status)
        ) || response.output.find((item: any) => item.type === 'message');
        
        if (!messageObj || !messageObj.content || !Array.isArray(messageObj.content)) {
          throw new Error('Could not find message object with content array in response');
        }
        
        // Find the output_text item containing the structured data
        const outputTextItem = messageObj.content.find((item: any) => 
          item.type === 'output_text'
        );
        
        if (!outputTextItem) {
          throw new Error('Could not find output_text item in message content');
        }
        
        // Extract the structured data
        if (typeof outputTextItem.text === 'string') {
          // If text is a JSON string, parse it
          const trimmed = outputTextItem.text.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            parsed = parseJsonFromModel(outputTextItem.text);
          } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            // JSON-encoded string - unescape it
            const unescaped = JSON.parse(outputTextItem.text);
            parsed = typeof unescaped === 'string' ? parseJsonFromModel(unescaped) : unescaped;
          } else {
            throw new Error(`Unexpected output_text format: ${trimmed.substring(0, 50)}`);
          }
        } else if (typeof outputTextItem.text === 'object' && outputTextItem.text !== null) {
          const obj = outputTextItem.text as Record<string, unknown>;
          const keys = Object.keys(obj);
          // API may return chunked text as object with numeric keys; reassemble and parse as JSON
          const allNumericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
          const allStringValues = keys.every((k) => typeof obj[k] === 'string');
          if (allNumericKeys && allStringValues) {
            const reassembled = keys
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => obj[k] as string)
              .join('');
            parsed = parseJsonFromModel(reassembled);
          } else {
            parsed = outputTextItem.text;
          }
        } else {
          throw new Error(`Unexpected output_text type: ${typeof outputTextItem.text}`);
        }
        
        Logger.debug('AgentBuilder', `Extracted structured data from array response`, {
          agentName,
          stageName,
          parsedKeys: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.keys(parsed as object) : [],
        });
      } else {
        throw new Error(`Unexpected response.output type: ${typeof response.output}`);
      }
      break;
    } catch (extractError) {
      // Check if the error might be due to truncation (even if finish_reason wasn't set)
      const isJsonParseError = extractError instanceof SyntaxError || 
                               (extractError as Error).message.includes('JSON') || 
                               (extractError as Error).message.includes('Unterminated') ||
                               (extractError as Error).message.includes('Unexpected end of JSON') ||
                               (extractError as Error).message.includes('double-quoted property name');
      
      // Get response as string to check length
      let responseString = '';
      if (typeof response.output === 'string') {
        responseString = response.output;
      } else if (Array.isArray(response.output)) {
        // Try to extract text from array response
        const messageObj = response.output.find((item: any) => item.type === 'message');
        if (messageObj?.content) {
          const outputTextItem = messageObj.content.find((item: any) => item.type === 'output_text');
          if (outputTextItem?.text && typeof outputTextItem.text === 'string') {
            responseString = outputTextItem.text;
          }
        }
      } else {
        responseString = JSON.stringify(response.output);
      }
      
      // Estimate tokens (rough: 1 token ≈ 4 characters)
      const estimatedTokens = Math.ceil(responseString.length / 4);
      const mightBeTruncated = isJsonParseError && (
        finishReason === 'length' || 
        finishReason === 'max_tokens' ||
        estimatedTokens > (maxOutputTokens * 0.9) // If we're using >90% of max tokens, likely truncated
      );
      
      if (mightBeTruncated) {
        const error = new Error(`Response was truncated due to max_output_tokens limit (${maxOutputTokens}). JSON parsing failed with "${(extractError as Error).message}". Estimated tokens: ${estimatedTokens}. Consider increasing max_output_tokens for ${agentName}.`);
        (error as any).code = 'TRUNCATED_RESPONSE';
        (error as any).retryable = true;
        Logger.logAgentError(agentName, error, stageName, {
          finishReason,
          maxOutputTokens,
          estimatedTokens,
          responseSize: responseString.length,
          parseError: (extractError as Error).message,
          responsePreview: responseString.substring(0, 500),
        }, agentId, stageId);
        throw error;
      }

      if (isJsonParseError && parseAttempt < maxParseAttempts) {
        Logger.warn('AgentBuilder', 'Structured JSON parse failed; retrying with fresh API call', {
          agentName,
          stageName,
          parseAttempt,
          maxParseAttempts,
          parseError: (extractError as Error).message,
        });
        // Log raw API response for debugging parse failures
        const parseFailurePayload = JSON.stringify({
          parseError: (extractError as Error).message,
          parseAttempt,
          maxParseAttempts,
          rawOutput: responseString,
          fullResponse: response,
        }, null, 2);
        writeLogFile(
          parseFailurePayload,
          agentName,
          stageName,
          'response',
          this.runId,
          { parseFailed: true, parseError: (extractError as Error).message, parseAttempt },
          undefined,
          agentId,
          stageId
        ).catch(err => {
          Logger.warn('AgentBuilder', 'Failed to write parse-failure response log', {
            agentName,
            stageName,
            error: (err as Error).message,
          });
        });

        const parseRetryOptions = createResponsesAbortOptions(timeoutMs);
        response = await (parseRetryOptions
          ? (client as any).responses.create(requestParams, parseRetryOptions)
          : (client as any).responses.create(requestParams));
        parseAttempt += 1;
        continue;
      }
      
      // For CV Optimizer, add specific error message about optimized_cv potentially being truncated
      let errorMessage = `Failed to extract structured data from response: ${(extractError as Error).message}`;
      if (this.resolvedOutputSchemaName === 'cv_optimization') {
        errorMessage += ` CV Optimizer response may be missing optimized_cv field. Check if response was truncated or if API omitted the field.`;
      }
      
      const error = new Error(errorMessage);
      (error as any).code = isJsonParseError ? 'JSON_PARSE_ERROR' : 'STRUCTURED_EXTRACT_ERROR';
      (error as any).retryable = isJsonParseError;
      // Log raw API response for debugging when we give up after all parse attempts
      const parseFailurePayload = JSON.stringify({
        parseError: (extractError as Error).message,
        parseAttempt,
        maxParseAttempts,
        rawOutput: responseString,
        fullResponse: response,
      }, null, 2);
      writeLogFile(
        parseFailurePayload,
        agentName,
        stageName,
        'response',
        this.runId,
        { parseFailed: true, parseError: (extractError as Error).message, parseAttempt, exhaustedRetries: true },
        undefined,
        agentId,
        stageId
      ).catch(err => {
        Logger.warn('AgentBuilder', 'Failed to write parse-failure response log', {
          agentName,
          stageName,
          error: (err as Error).message,
        });
      });
      Logger.logAgentError(agentName, error, stageName, {
        outputType: typeof response.output,
        isArray: Array.isArray(response.output),
        finishReason,
        maxOutputTokens,
        estimatedTokens: responseString ? Math.ceil(responseString.length / 4) : 0,
        outputPreview: typeof response.output === 'string' 
          ? response.output.substring(0, 200) 
          : JSON.stringify(response.output).substring(0, 200),
        isCVOptimizer: isCvOptimizerAgent(this.config),
        potentialOptimizedCvTruncation: isCvOptimizerAgent(this.config),
      }, agentId, stageId);
      throw error;
    }
    }

    parsed = handler.postProcessBeforeValidation?.(parsed, {
      inputData: this.inputData,
      candidateProfile: this.candidateProfile,
      config: this.config,
      agentId: this.config.id,
      agentName,
      stageName,
    }) ?? parsed;

    // Response will be logged after validation/coercion so we log the final return value (e.g. sections-only for Background)

        let validated: unknown;
        try {
          validated = this.outputSchema.parse(parsed);
          // Normalize score when model returns 0-10 scale (e.g. 7) instead of 0-100 (e.g. 74)
          if (
            validated &&
            typeof validated === 'object' &&
            !Array.isArray(validated) &&
            'score' in validated &&
            typeof (validated as Record<string, unknown>).score === 'number'
          ) {
            const rawScore = (validated as Record<string, unknown>).score as number;
            const { score: normalizedScore, corrected } = normalizeAssessmentScore(rawScore);
            if (corrected) {
              (validated as Record<string, unknown>).score = normalizedScore;
              Logger.warn('AgentBuilder', 'Score looked like 0-10 scale, normalized to 0-100', {
                agentName,
                stageName,
                originalScore: rawScore,
                correctedScore: normalizedScore,
              });
            }
          }
          validated = handler.postProcessAfterValidation?.(validated, this.config) ?? validated;
          validated = normalizeStructuredListFields(this.resolvedOutputSchemaName, validated);
      const totalLatency = Date.now() - invokeStartTime;
      const outputSize = JSON.stringify(validated).length;

      // Log the final return value (validated/coerced) as pretty-printed JSON
      const usageNorm = response.usage ? normaliseApiUsage(response.usage as UsageLike) : null;
      writeLogFile(
        JSON.stringify(validated, null, 2),
        agentName,
        stageName,
        'response',
        this.runId,
        {
          durationMs: totalLatency,
          apiLatency,
          finishReason,
          tokenUsage: usageNorm ? {
            promptTokens: usageNorm.inputTokens,
            completionTokens: usageNorm.outputTokens,
            totalTokens: usageNorm.totalTokens,
          } : null,
          responseId: response.id,
          model: apiModelName,
        },
        undefined,
        agentId,
        stageId
      ).catch(err => {
        Logger.warn('AgentBuilder', 'Failed to write response log file', {
          agentName,
          stageName,
          error: (err as Error).message,
        });
      });
      
      Logger.logAgentComplete(
        agentName,
        totalLatency,
        outputSize,
        usageNorm ? {
          prompt_tokens: usageNorm.inputTokens,
          completion_tokens: usageNorm.outputTokens,
          total_tokens: usageNorm.totalTokens,
        } : undefined,
        stageName,
        agentId,
        stageId
      );

      const tokenUsage = usageNorm ? { ...usageNorm, model: apiModelName } : undefined;
      return { result: validated, tokenUsage };
    } catch (e) {
      const recovered = handler.tryRecoverFromValidationError?.(parsed, this.config);
      if (recovered != null) {
        const recoveryDurationMs = Date.now() - invokeStartTime;
        const recoveryUsageNorm = response.usage ? normaliseApiUsage(response.usage as UsageLike) : null;
        writeLogFile(
          JSON.stringify(recovered, null, 2),
          agentName,
          stageName,
          'response',
          this.runId,
          {
            durationMs: recoveryDurationMs,
            apiLatency,
            finishReason,
            tokenUsage: recoveryUsageNorm ? { promptTokens: recoveryUsageNorm.inputTokens, completionTokens: recoveryUsageNorm.outputTokens, totalTokens: recoveryUsageNorm.totalTokens } : null,
            responseId: response.id,
            model: apiModelName,
          },
          undefined,
          agentId,
          stageId
        ).catch(err => Logger.warn('AgentBuilder', 'Failed to write response log file', { agentName, stageName, error: (err as Error).message }));
        const tokenUsage = recoveryUsageNorm
          ? { ...recoveryUsageNorm, model: apiModelName }
          : undefined;
        return { result: recovered, tokenUsage };
      }
      if (validationAttempt < maxValidationAttempts) {
        const fullMessage = (e as Error).message;
        const schemaErrorSummary = fullMessage.length > 400 ? `${fullMessage.slice(0, 400)}...` : fullMessage;
        Logger.warn('AgentBuilder', 'Schema validation failed, retrying with fresh API call', {
          agentName,
          stageName,
          validationAttempt,
          maxValidationAttempts,
          schemaErrorSummary,
          agentId,
          stageId,
        });
        validationAttempt += 1;
        const validationRetryOptions = createResponsesAbortOptions(timeoutMs);
        response = await (validationRetryOptions
          ? (client as any).responses.create(requestParams, validationRetryOptions)
          : (client as any).responses.create(requestParams));
        continue;
      }
      const error = new Error(`Failed to validate output against schema: ${(e as Error).message}`);
      Logger.logAgentError(agentName, error, stageName, {
        parsedKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed as object) : [],
        schemaError: (e as Error).message,
      }, agentId, stageId);
      throw error;
    }
  }
  // Unreachable: every path through the validation loop returns or throws
  throw new Error('Invariant: validation loop exited without return or throw');
  }
}



