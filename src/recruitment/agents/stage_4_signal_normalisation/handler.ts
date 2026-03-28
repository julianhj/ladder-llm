import type { AgentConfig } from '../agentConfig.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';

const CALIBRATION_SCHEMAS: OutputSchemaName[] = [
  'signal_normalized',
  'recruiter_reality_validation',
  'evidence_synthesiser',
  'panel_weighting',
  'anomaly_detection',
  'seniority_signal_enforcement',
];

export const calibrationHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName): boolean {
    return CALIBRATION_SCHEMAS.includes(outputSchema);
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
