/**
 * Roll up token counts by LLM model id (e.g. gpt-5.2 vs gpt-5.4-mini).
 */

import type { AgentsConfig, OpenAIConfig } from '../loaders/ConfigLoader.js';

/** Resolve model id for a pipeline agent from merged agents.json + openai.json. */
export function resolvePipelineAgentModelName(
  agentsConfig: AgentsConfig,
  openaiConfig: OpenAIConfig,
  agentId: string
): string {
  for (const stage of agentsConfig.stages) {
    const agent = stage.agents.find(a => a.id === agentId);
    if (agent?.modelParams?.model) return agent.modelParams.model;
  }
  if (agentsConfig.defaultModel?.name) return agentsConfig.defaultModel.name;
  if (openaiConfig.defaultModel?.name) return openaiConfig.defaultModel.name;
  return 'unknown';
}

export interface TokenUsageByModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenUsageRowWithModel {
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Sum token usage into buckets keyed by model. Rows with missing/blank model go to `unknownLabel`.
 */
export function aggregateTokenUsageByModel(
  rows: TokenUsageRowWithModel[],
  unknownLabel = 'unknown'
): TokenUsageByModel[] {
  const map = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();
  for (const row of rows) {
    const key = row.model?.trim() ? row.model.trim() : unknownLabel;
    const cur = map.get(key) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    cur.inputTokens += row.inputTokens;
    cur.outputTokens += row.outputTokens;
    cur.totalTokens += row.totalTokens;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, u]) => ({ model, ...u }));
}
