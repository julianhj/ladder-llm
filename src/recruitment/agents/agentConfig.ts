import type { OutputSchemaName } from './schemaRegistry.js';

/**
 * Input dependency ref.
 * - true: from pipeline context (e.g. structuredCV, consensus_feedback).
 * - { from: "agent_id" }: from that agent's result (previous wave).
 * - { from: "input", field: "path", description?: "..." }: from pipeline input at path; description used when building prompt Inputs section from config.
 * - { from: "stage", stageId, field?: "result.path", description?: "..." }: from that stage's results; if field is set, inject the extracted value as this input (runner resolves).
 * - { from: "composite", stageIds, description?: "..." }: logical source is composite of those stages (runner resolves and injects).
 */
export type AgentInputRef =
  | boolean
  | { from: string; field?: string; description?: string }
  | { from: 'stage'; stageId: string; field?: string; description?: string }
  | { from: 'composite'; stageIds: string[]; description?: string };

/**
 * Ref that describes where previousStageResults come from. Used by PipelineRunner to resolve and inject.
 * For from: 'stage', optional field is a dot-separated path (e.g. result.signal_blocks) to extract
 * from each result before passing; when set, each item becomes { agentId, agentName, success, result: extracted }.
 * For from: 'composite', optional stageFields maps stageId -> path(s) to extract per result; when set,
 * each stage's results are trimmed to only those fields (single path -> result is the value; string[]
 * -> result is object with keys from path suffixes, e.g. result.scope_signals -> scope_signals).
 */
export type PreviousStageResultsRef =
  | { from: 'stage'; stageId: string; field?: string }
  | { from: 'composite'; stageIds: string[]; stageFields?: Record<string, string | string[]> };

export interface AgentConfig {
  id: string;
  name: string;
  promptBase: string; // Base path without version (e.g., "interviewers/technical_interviewer")
  version: string; // Prompt version (semver format, e.g., "1.0.0")
  outputSchema?: OutputSchemaName;
  inputFiles?: {
    candidateCV?: string;
    jobDescription?: string;
    previousStageResults?: string;
    [key: string]: string | undefined;
  };
  /**
   * Input dependencies for Stage 3 parallel agents.
   * - true: inject from pipeline context (e.g. structuredCV, consensus_feedback).
   * - { from: "agent_id" }: inject from that agent's result (previous wave).
   * - { from: "input", field: "structuredCV.skills" }: inject from pipeline input at path.
   */
  inputs?: Record<string, AgentInputRef>;
  /**
   * When true, do not add or emit the full structuredCV and structuredJobDescription documents.
   * Pipeline-injected slices (e.g. structuredJobDescription_role_title, structuredCV_skills) are still included when configured in inputs.
   */
  excludeFullStructuredDocuments?: boolean;
  /** When true, do not add or emit the full structuredCV document. Pipeline-injected slices (e.g. structuredCV_skills) from config inputs are still included. */
  excludeFullStructuredCV?: boolean;
  /** When true, do not add or emit the full structuredJobDescription document. Pipeline-injected slices (e.g. structuredJobDescription_role_title) from config inputs are still included. Use when the agent needs only CV or previous-stage results (e.g. Career Trajectory). */
  excludeFullStructuredJD?: boolean;
  /**
   * When true, emit only previousStageResults in the input context (no name, email, company_name, role, verbosity, etc.).
   * Use for pure aggregation agents (e.g. signal normaliser) that should see only interviewer outputs.
   */
  inputOnlyPreviousStageResults?: boolean;
  /** Optional per-agent request timeout in milliseconds. Overrides global openai.json timeout. */
  timeout?: number;
  /**
   * Optional list of common prompt fragment keys to inject into the prompt object.
   * Allowed values: json_output_format, output_verbosity_enforcement, seniority_alignment, llm_responsibilities, cv_optimization_level_guidance.
   * See configs/README.md.
   */
  injectedPrompts?: string[];
  /** Optional instructions appended to the loaded prompt file. Used when instructions are kept in config. */
  promptInstructions?: string;
  modelParams?: {
    /** Model id; overrides `agents.json` `defaultModel.name` when set. If still unset after load, `openai.json` `defaultModel.name` is used. */
    model?: string;
    temperature?: number;
    max_tokens?: number;
    reasoning?: {
      effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    };
  };
  /** API-facing catalog metadata consumed by the LLM Worker API. */
  catalog?: {
    role: string;
    expertise: string[];
    available_tasks: string[];
    description: string;
    instructions: string;
  };
}
