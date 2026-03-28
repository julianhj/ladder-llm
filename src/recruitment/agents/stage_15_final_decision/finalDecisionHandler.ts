import type { AgentConfig } from '../agentConfig.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';

export const finalDecisionHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName): boolean {
    return outputSchema === 'final_decision';
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

  getSystemMessage(): string {
    return '';
  },
};
