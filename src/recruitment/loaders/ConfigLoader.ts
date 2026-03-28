import { readFile } from 'fs/promises';
import path from 'path';
import type { AgentConfig } from '../agents/agentConfig.js';
import { Logger } from '../utils/Logger.js';
import { getConfigLoaderDir } from './configLoaderDir.js';
import { getOpenAiResourceProvider } from '../runtime/resourceProvider.js';

const _dir = getConfigLoaderDir();

/** Used only when `openai.json` cannot be read (bootstrap default). Not for per-agent selection. */
export const OPENAI_CONFIG_FILE_FALLBACK_MODEL_NAME = 'gpt-4o-mini';

/**
 * Default LLM settings for all pipeline agents in `agents.json`.
 * Each agent's `modelParams` overrides these fields when set (e.g. `model`, `temperature`, `max_tokens`).
 */
export interface AgentsDefaultModel {
  name: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * CV + Job Description extractors (preprocessing). Overrides openai.json `preprocessingModel` / `defaultModel` when `name` is set.
 */
export interface AgentsPreprocessingModel {
  /** OpenAI model id (e.g. gpt-5.4-mini). */
  name: string;
  temperature?: number;
  max_tokens?: number;
}

function mergeAgentDefaultModel(agent: AgentConfig, defaults: AgentsDefaultModel): AgentConfig {
  const mp = agent.modelParams ?? {};
  const merged: NonNullable<AgentConfig['modelParams']> = {
    model: defaults.name,
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.max_tokens !== undefined ? { max_tokens: defaults.max_tokens } : {}),
    ...mp,
  };
  return { ...agent, modelParams: merged };
}

function applyAgentsDefaultModels(config: AgentsConfig): AgentsConfig {
  const d = config.defaultModel;
  if (!d?.name) return config;
  return {
    ...config,
    stages: config.stages.map(stage => ({
      ...stage,
      agents: stage.agents.map(agent => mergeAgentDefaultModel(agent, d)),
    })),
  };
}

/** Reference to an agent result or pipeline input for mergeOutputs.output. When referring to an agent, use the agent's id. */
export interface MergeOutputFieldRef {
  from: string; // Agent id or "input"
  field: string;
}

/** Shallow combine merge: build one object from sourceAgents by mapping output fields. sourceAgents and output.*.from use agent ids. */
export interface MergeOutputsCombineConfig {
  type: 'combine';
  mode?: 'shallow';
  sourceAgents: string[]; // Agent ids
  output: Record<string, unknown>; // Values can be MergeOutputFieldRef or nested { from, field }
  instructions?: string;
}

/** Legacy json_merge (e.g. Stage 8). */
export interface MergeOutputsJsonMergeConfig {
  type: 'json_merge';
  strategy: string;
  schema: string;
  instructions?: string;
}

export type MergeOutputsConfig =
  | MergeOutputsJsonMergeConfig
  | MergeOutputsCombineConfig;

export interface StageConfig {
  id: string;
  name: string;
  agents: AgentConfig[];
  /** When true, run all agents in this stage in parallel. Used for Stage 0 with multiple fragment agents. */
  parallel?: boolean;
  /** After running agents, merge successful results into a single object (e.g. consensus partials). */
  mergeOutputs?: MergeOutputsConfig;
}

export interface AgentsConfig {
  version?: string; // Config file version (semver format)
  lastModified?: string; // Last modification date
  /**
   * Default model and optional sampling params for every pipeline agent.
   * Override per agent with `modelParams.model`, `modelParams.temperature`, `modelParams.max_tokens`.
   * Final fallback if `name` is still unset: `openai.json` `defaultModel.name`.
   */
  defaultModel?: AgentsDefaultModel;
  /**
   * Preprocessing (CV extractor + job description extractor). When `name` is set, takes precedence over
   * [openai.json](openai.json) `preprocessingModel` and `defaultModel` for those calls only.
   */
  preprocessing?: AgentsPreprocessingModel;
  /**
   * Stage execution parallelism (single source of truth).
   * - First element (index 0): stage ids that run in parallel with the whole pipeline. Started at pipeline
   *   start; each result is injected before the first main stage that depends on it (via inputs.previousStageResults).
   * - Remaining elements: batch groups. Each inner array is [firstStageId, ...rest]; when the runner reaches
   *   the first stage in a group, it runs all stages in that group in parallel, then continues.
   */
  parallelStageGroups?: string[][];
  stages: StageConfig[];
}

export interface OpenAIConfig {
  version?: string;
  lastModified?: string;
  apiKey?: string; // Can use ${ENV_VAR} syntax for environment variable substitution
  baseURL?: string; // API base URL (defaults to https://api.openai.com/v1)
  timeout?: number; // Request timeout in milliseconds
  maxRetries?: number; // Maximum number of retries
  defaultModel?: {
    name: string;
    temperature: number;
    maxTokens: number;
  };
  preprocessingModel?: {
    name: string;
    temperature: number;
    maxTokens: number;
  };
  systemMessage?: string;
  pricing?: {
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    currency: string;
    lastUpdated: string;
  };
}

export class ConfigLoader {
  static async loadAgentsConfig(): Promise<AgentsConfig> {
    const provider = getOpenAiResourceProvider();
    const providerRaw = await provider?.getConfigJson?.('agents');
    const filePath = path.resolve(_dir, '../../../configs/agents.json');
    const raw = providerRaw ?? (await readFile(filePath, 'utf-8'));
    const parsed = JSON.parse(raw) as AgentsConfig;
    const config = applyAgentsDefaultModels(parsed);

    if (config.version) {
      // Extract agent versions for verification logging
      const agentVersions = config.stages.flatMap(stage => 
        stage.agents.map(agent => ({
          name: agent.name,
          promptBase: agent.promptBase,
          version: agent.version,
        }))
      );
      
      Logger.info('ConfigLoader', 'Loaded agents configuration', {
        configVersion: config.version,
        lastModified: config.lastModified,
        stageCount: config.stages.length,
        totalAgents: agentVersions.length,
        agentVersions: agentVersions,
      });
    }
    
    return config;
  }

  /**
   * Resolves environment variable references in config values
   * Supports ${VAR_NAME} syntax
   */
  private static resolveEnvVars(value: string): string {
    if (!value || typeof value !== 'string') {
      return value;
    }
    
    // Replace ${VAR_NAME} with environment variable value
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        Logger.warn('ConfigLoader', `Environment variable ${varName} not found, using literal value`, {
          varName,
          originalValue: match,
        });
        return match; // Return original if env var not found
      }
      return envValue;
    });
  }

  static async loadOpenAIConfig(): Promise<OpenAIConfig> {
    const provider = getOpenAiResourceProvider();
    const filePath = path.resolve(_dir, '../../../configs/openai.json');
    try {
      const providerRaw = await provider?.getConfigJson?.('openai');
      const raw = providerRaw ?? (await readFile(filePath, 'utf-8'));
      const config = JSON.parse(raw) as OpenAIConfig;
      
      // Resolve environment variables in apiKey and baseURL
      if (config.apiKey) {
        config.apiKey = this.resolveEnvVars(config.apiKey);
        // If the resolved value is still a template string (env var not found), treat as missing
        if (config.apiKey.startsWith('${') && config.apiKey.endsWith('}')) {
          config.apiKey = undefined;
        }
      }
      if (config.baseURL) {
        config.baseURL = this.resolveEnvVars(config.baseURL);
      }
      
      // Fallback to environment variable if apiKey not in config or unresolved
      if (!config.apiKey) {
        config.apiKey = process.env.OPENAI_API_KEY;
      }
      
      if (config.version) {
        Logger.debug('ConfigLoader', 'Loaded OpenAI configuration', {
          version: config.version,
          lastModified: config.lastModified,
          baseURL: config.baseURL || 'https://api.openai.com/v1',
          hasApiKey: !!config.apiKey,
          defaultModel: config.defaultModel?.name || 'gpt-4o-mini',
        });
      }
      
      return config;
    } catch (error) {
      Logger.warn('ConfigLoader', 'Could not load OpenAI config, using defaults', {
        error: (error as Error).message,
      });
      // Return default config if file doesn't exist
      return {
        version: '1.0.0',
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
        timeout: 180000,
        maxRetries: 3,
        defaultModel: {
          name: OPENAI_CONFIG_FILE_FALLBACK_MODEL_NAME,
          temperature: 0.7,
          maxTokens: 1000,
        },
        systemMessage: 'You are an expert evaluator following strict JSON output rules.',
        pricing: {
          inputCostPerMillion: 0.15,
          outputCostPerMillion: 0.60,
          currency: 'USD',
          lastUpdated: '2024-11-06',
        },
      };
    }
  }
}

