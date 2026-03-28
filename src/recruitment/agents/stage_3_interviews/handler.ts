import type { AgentConfig } from '../agentConfig.js';
import type { CandidateProfile } from '../schemas/index.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler, InputContextOptions } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';
import { scoreToFinalDecision } from '../../logic/signal_layer/scoreCandidate.js';
import { isConsensusAgent, mapVerbosityForConsensus, getMetadataKeyExclusionsForAgent } from '../agentKind.js';

export const assessmentHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName, agentId?: string): boolean {
    return (
      outputSchema === 'assessment' ||
      outputSchema === 'interview_assessment' ||
      outputSchema === 'consensus' ||
      agentId === 'consensus_decision_maker'
    );
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

  enrichInputData(
    inputData: Record<string, string>,
    candidateProfile: CandidateProfile,
    config: AgentConfig
  ): void {
    if (isConsensusAgent(config)) {
      inputData['verbosity_level'] = mapVerbosityForConsensus(candidateProfile.verbosity_level);
    }
  },

  getInputContextOptions(config: AgentConfig): InputContextOptions {
    return {
      excludeKeys: new Set<string>(),
      excludeMetadataKeys: getMetadataKeyExclusionsForAgent(config),
    };
  },

  postProcessAfterValidation(validated: unknown, config: AgentConfig): unknown {
    if (config.outputSchema !== 'assessment' && config.outputSchema !== 'interview_assessment') return validated;
    if (!validated || typeof validated !== 'object' || Array.isArray(validated)) return validated;
    const obj = validated as Record<string, unknown>;
    const score = obj.score;
    if (typeof score !== 'number' || Number.isNaN(score)) return validated;
    const decision = scoreToFinalDecision(score);
    obj.decision = decision;
    obj.final_decision = decision;
    return validated;
  },
};
