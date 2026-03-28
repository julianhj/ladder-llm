import { readFile } from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { Logger } from '../utils/Logger.js';
import { parsePromptYaml, renderStructuredPrompt } from '../utils/PromptVersion.js';
import { getOpenAiResourceProvider } from '../runtime/resourceProvider.js';

export interface CommonPromptFragments {
  outputVerbosityEnforcement: string;
  cvOptimizationLevelGuidance: string;
  seniorityAlignment: string;
  llmResponsibilities: string;
  jsonOutputFormat: string;
  /** Per-level summary for injection next to verbosity_level in the prompt. Keys: concise, moderate, detailed. */
  verbositySummaries?: Record<string, string>;
}

/** Map from agents.json injectedPrompts key to CommonPromptFragments key. Single source of truth for config-driven injection. */
export const INJECTED_PROMPT_KEY_TO_FRAGMENT: Record<string, keyof Omit<CommonPromptFragments, 'verbositySummaries'>> = {
  json_output_format: 'jsonOutputFormat',
  output_verbosity_enforcement: 'outputVerbosityEnforcement',
  seniority_alignment: 'seniorityAlignment',
  llm_responsibilities: 'llmResponsibilities',
  cv_optimization_level_guidance: 'cvOptimizationLevelGuidance',
};

type StringFragmentKey =
  | 'outputVerbosityEnforcement'
  | 'cvOptimizationLevelGuidance'
  | 'seniorityAlignment'
  | 'llmResponsibilities'
  | 'jsonOutputFormat';

const FRAGMENT_FILES: Array<{ key: StringFragmentKey; file: string }> = [
  { key: 'outputVerbosityEnforcement', file: 'output_verbosity_enforcement.v1.2.0.yaml' },
  { key: 'cvOptimizationLevelGuidance', file: 'cv_optimization_level_guidance.v1.1.0.yaml' },
  { key: 'seniorityAlignment', file: 'seniority_alignment.v2.0.0.yaml' },
  { key: 'llmResponsibilities', file: 'llm_responsibilities.yaml' },
  { key: 'jsonOutputFormat', file: 'json_output_format.v1.1.0.yaml' },
];

const loadCache = new Map<string, Promise<CommonPromptFragments>>();

/**
 * Load all common prompt fragments from disk (YAML). Safe for parallel execution.
 * Returns the prompt body from each YAML file. For output_verbosity_enforcement, also extracts
 * verbosity_levels into verbositySummaries so the current level's meaning can be injected into the prompt.
 */
export async function loadCommonPromptFragments(agentBuilderDir: string): Promise<CommonPromptFragments> {
  const cached = loadCache.get(agentBuilderDir);
  if (cached) return cached;

  const promise = (async (): Promise<CommonPromptFragments> => {
    const commonBase = path.resolve(agentBuilderDir, '../../../prompts/common');
    let verbositySummaries: Record<string, string> | undefined;

    const results = await Promise.all(
      FRAGMENT_FILES.map(async ({ key, file }) => {
        const filePath = path.join(commonBase, file);
        try {
          const provider = getOpenAiResourceProvider();
          const content = (await provider?.getPromptText?.(`common/${file}`)) ?? (await readFile(filePath, 'utf-8'));
          if (key === 'outputVerbosityEnforcement') {
            const parsed = parseYaml(content, { schema: 'core' }) as Record<string, unknown> | null;
            const promptObj = parsed?.prompt;
            if (promptObj && typeof promptObj === 'object' && !Array.isArray(promptObj)) {
              const levels = (promptObj as Record<string, unknown>).verbosity_levels as Record<string, string> | undefined;
              if (levels && typeof levels === 'object') {
                verbositySummaries = {
                  concise: typeof levels.concise === 'string' ? levels.concise : '',
                  moderate: typeof levels.moderate === 'string' ? levels.moderate : '',
                  detailed: typeof levels.detailed === 'string' ? levels.detailed : '',
                };
              }
            }
            const prompt =
              typeof promptObj === 'string'
                ? promptObj
                : promptObj && typeof promptObj === 'object'
                  ? renderStructuredPrompt(promptObj as Record<string, unknown>)
                  : parsePromptYaml(content).prompt;
            return { key, content: prompt };
          }
          const { prompt } = parsePromptYaml(content);
          return { key, content: prompt };
        } catch (error) {
          Logger.warn('AgentBuilder', `Could not load common fragment: ${file}`, {
            error: (error as Error).message,
          });
          return { key, content: '' };
        }
      })
    );

    const fragments: CommonPromptFragments = {
      outputVerbosityEnforcement: '',
      cvOptimizationLevelGuidance: '',
      seniorityAlignment: '',
      llmResponsibilities: '',
      jsonOutputFormat: '',
    };
    for (const { key, content } of results) {
      fragments[key] = content;
    }
    if (verbositySummaries) {
      fragments.verbositySummaries = verbositySummaries;
    }
    return fragments;
  })();

  loadCache.set(agentBuilderDir, promise);
  return promise;
}
