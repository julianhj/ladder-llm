import type { AgentConfig } from './agentConfig.js';
import type { CandidateProfile } from './schemas/index.js';

export function isConsensusAgent(config: AgentConfig): boolean {
  return (
    config.outputSchema === 'consensus' ||
    config.id === 'consensus_decision_maker' ||
    config.name === 'Consensus Decision Maker'
  );
}

export function isCvOptimizerAgent(config: AgentConfig): boolean {
  return (
    config.outputSchema === 'cv_optimization' ||
    config.id === 'cv_optimizer' ||
    config.name === 'CV Optimizer'
  );
}

const CV_OPTIMIZER_ONLY_METADATA_KEYS = ['cv_optimization_rerun_count', 'previous_optimization_did_not_improve_scores'] as const;
const CONSENSUS_OR_CV_OPTIMIZER_METADATA_KEYS = ['previous_run_scores', 'previous_final_decision'] as const;

/**
 * Metadata keys to omit from the serialized user JSON unless the agent is CV optimizer and/or consensus as appropriate.
 * Matches legacy AgentBuilder.buildInputContext rules.
 */
export function getMetadataKeyExclusionsForAgent(config: AgentConfig): Set<string> {
  const s = new Set<string>();
  if (!isCvOptimizerAgent(config)) {
    for (const k of CV_OPTIMIZER_ONLY_METADATA_KEYS) {
      s.add(k);
    }
  }
  if (!isCvOptimizerAgent(config) && !isConsensusAgent(config)) {
    for (const k of CONSENSUS_OR_CV_OPTIMIZER_METADATA_KEYS) {
      s.add(k);
    }
  }
  return s;
}

export function mapVerbosityForConsensus(
  verbosity: CandidateProfile['verbosity_level']
): 'low' | 'medium' | 'high' {
  switch (verbosity) {
    case 'concise':
      return 'low';
    case 'detailed':
      return 'high';
    case 'moderate':
    default:
      return 'medium';
  }
}
