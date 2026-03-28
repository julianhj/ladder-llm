import type { AgentConfig } from '../agentConfig.js';
import type { CommonPromptFragments } from '../promptLoader.js';
import type { CandidateProfile } from '../schemas/index.js';
import type { OutputSchemaName } from '../schemaRegistry.js';

export interface PostProcessContext {
  inputData: Record<string, string>;
  candidateProfile: CandidateProfile | null;
  config: AgentConfig;
  agentId: string;
  agentName: string;
  stageName?: string;
}

export interface InputContextOptions {
  excludeKeys: Set<string>;
  keyOrder?: string[];
  /**
   * Additional metadata keys to omit from the serialized user JSON (beyond excludeKeys).
   * When omitted, AgentBuilder merges defaults from getMetadataKeyExclusionsForAgent(config).
   */
  excludeMetadataKeys?: Set<string>;
}

/** OpenAI Responses API tool entry (e.g. web_search). */
export type ResponsesApiTool = { type: string; [key: string]: unknown };

/**
 * Agent-type handler: prompt building, system message, input enrichment, and optional
 * response post-processing. All methods are stateless (receive context as arguments).
 */
export interface AgentTypeHandler {
  appliesTo(outputSchema: OutputSchemaName, agentId?: string): boolean;

  /** Build prompt as object (add keys from fragments/config); used for JSON prompt pipeline. */
  buildPromptObject(
    fragments: CommonPromptFragments,
    promptObject: Record<string, unknown>,
    config: AgentConfig
  ): Record<string, unknown>;

  /** @deprecated Use buildPromptObject; kept for backward compatibility during migration. */
  buildPrompt?(
    fragments: CommonPromptFragments,
    basePrompt: string,
    config: AgentConfig
  ): string;

  getSystemMessage(config: AgentConfig): string;

  /**
   * Final system message for the merged prompt object.
   * When omitted, AgentBuilder uses: background agents -> getSystemMessage only; else openAiGlobal ?? getSystemMessage.
   */
  resolveSystemMessage?(config: AgentConfig, openAiGlobalSystemMessage: string | undefined): string;

  /** Shown when the user input JSON would otherwise be empty (before the JSON-only suffix). */
  getEmptyUserInputFallback?(config: AgentConfig): string;

  /** Extra Responses API tools (e.g. web_search for background research). */
  getResponsesTools?(config: AgentConfig): ResponsesApiTool[] | undefined;

  enrichInputData?(
    inputData: Record<string, string>,
    candidateProfile: CandidateProfile,
    config: AgentConfig
  ): void;

  getInputContextOptions?(config: AgentConfig): InputContextOptions;

  postProcessBeforeValidation?(parsed: unknown, context: PostProcessContext): unknown;

  postProcessAfterValidation?(validated: unknown, config: AgentConfig): unknown;

  tryRecoverFromValidationError?(parsed: unknown, config: AgentConfig): unknown | null;
}
