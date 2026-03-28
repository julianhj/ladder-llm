import type { AgentConfig } from '../agentConfig.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler, InputContextOptions } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';
import { getMetadataKeyExclusionsForAgent } from '../agentKind.js';

const CONSENSUS_PARTIAL_SCHEMAS: Set<string> = new Set([
  'consensus_partial_alignment',
  'consensus_partial_key_strengths',
  'consensus_partial_risk_areas',
  'consensus_partial_hiring_recommendation',
  'consensus_partial_scores',
  'consensus_partial_reasoning',
]);

export const consensusPartialHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName): boolean {
    return CONSENSUS_PARTIAL_SCHEMAS.has(outputSchema);
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

  getSystemMessage(_config: AgentConfig): string {
    return '';
  },

  getInputContextOptions(config: AgentConfig): InputContextOptions {
    return {
      excludeKeys: new Set<string>(),
      excludeMetadataKeys: getMetadataKeyExclusionsForAgent(config),
    };
  },
};
