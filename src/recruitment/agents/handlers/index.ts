import type { AgentConfig } from '../agentConfig.js';
import type { CandidateProfile } from '../schemas/index.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler, InputContextOptions } from './types.js';
import type { CommonPromptFragments } from '../promptLoader.js';
import {
  isConsensusAgent,
  isCvOptimizerAgent,
  mapVerbosityForConsensus,
  getMetadataKeyExclusionsForAgent,
} from '../agentKind.js';
import { assessmentHandler } from '../stage_3_interviews/handler.js';
import { calibrationHandler } from '../stage_4_signal_normalisation/handler.js';
import { finalDecisionHandler } from '../stage_15_final_decision/finalDecisionHandler.js';
import { cvOptimizationHandler } from '../stage_15_final_decision/cvOptimizationHandler.js';
import { formattedSkillsHandler } from '../stage_15_final_decision/formattedSkillsHandler.js';
import { formattedExperienceHandler } from '../stage_15_final_decision/formattedExperienceHandler.js';

function defaultGetSystemMessage(_config: AgentConfig): string {
  return '';
}

/**
 * Default handler: preserves current AgentBuilder behaviour for all agent types.
 * Used when no specific handler is registered for a given outputSchema/agentName.
 */
function createDefaultHandler(): AgentTypeHandler {
  return {
    appliesTo(): boolean {
      return true;
    },

    buildPromptObject(
      _fragments: CommonPromptFragments,
      promptObject: Record<string, unknown>,
      _config: AgentConfig
    ): Record<string, unknown> {
      return promptObject;
    },

    buildPrompt(_fragments: CommonPromptFragments, basePrompt: string, _config: AgentConfig): string {
      return basePrompt;
    },

    getSystemMessage: defaultGetSystemMessage,

    resolveSystemMessage(_config: AgentConfig, openAiGlobalSystemMessage: string | undefined): string {
      return openAiGlobalSystemMessage ?? defaultGetSystemMessage(_config);
    },

    getEmptyUserInputFallback(_config: AgentConfig): string {
      return 'Please provide your assessment.';
    },

    enrichInputData(
      inputData: Record<string, string>,
      candidateProfile: CandidateProfile,
      config: AgentConfig
    ): void {
      if (isConsensusAgent(config)) {
        inputData['verbosity_level'] = mapVerbosityForConsensus(candidateProfile.verbosity_level);
      }
      if (isCvOptimizerAgent(config)) {
        inputData['target_role_title'] = candidateProfile.role_applying_for ?? '';
        const orgScope = candidateProfile.org_scope_metadata;
        if (orgScope && typeof orgScope === 'object' && Object.keys(orgScope).length > 0) {
          inputData['org_scope_metadata'] = JSON.stringify(orgScope);
        }
      }
    },

    getInputContextOptions(config: AgentConfig): InputContextOptions {
      return {
        excludeKeys: new Set<string>(),
        excludeMetadataKeys: getMetadataKeyExclusionsForAgent(config),
      };
    },
  };
}

const defaultHandler = createDefaultHandler();

const HANDLERS: AgentTypeHandler[] = [
  assessmentHandler,
  cvOptimizationHandler,
  formattedSkillsHandler,
  formattedExperienceHandler,
  finalDecisionHandler,
  calibrationHandler,
  defaultHandler,
];

/**
 * Returns the handler for the given outputSchema and optional agentId.
 * First matching specific handler wins; otherwise returns the default handler.
 */
export function getHandler(
  outputSchema: OutputSchemaName,
  agentId?: string
): AgentTypeHandler {
  for (const h of HANDLERS) {
    if (h.appliesTo(outputSchema, agentId)) {
      return h;
    }
  }
  return defaultHandler;
}

export type { AgentTypeHandler, InputContextOptions, PostProcessContext, ResponsesApiTool } from './types.js';
