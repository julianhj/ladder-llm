/**
 * Max output token caps per model for clamping API requests.
 * Unknown models fall back to DEFAULT_MAX_OUTPUT_TOKENS unless a known prefix matches.
 */

export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

/** Exact model id (lowercase) -> max output tokens */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'gpt-5': 128000,
  'gpt-5.1': 128000,
  'gpt-5.2': 128000,
  'gpt-5.2-2025-12-11': 128000,
  'gpt-5.4': 128000,
  'gpt-5-mini-2025-08-07': 128000,
  'gpt-5-nano': 128000,
  'gpt-5.4-mini': 128000,
  'gpt-4.1-nano': 1000000,
  'gpt-4o-mini': 16384,
  'gpt-4o': 16384,
  'gpt-4-turbo': 4096,
  'gpt-4-turbo-preview': 4096,
  'gpt-4-32k': 32768,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16384,
  o1: 16384,
  'o1-preview': 16384,
  o3: 16384,
};

function stripTrailingSnapshotSuffix(id: string): string {
  return id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/**
 * Returns a conservative max_output_tokens cap for the given model name (any casing).
 */
export function getModelMaxOutputTokens(modelName: string): number {
  const key = modelName.toLowerCase();
  const direct = MODEL_MAX_OUTPUT_TOKENS[key];
  if (direct !== undefined) return direct;
  const stripped = stripTrailingSnapshotSuffix(key);
  if (stripped !== key) {
    const s = MODEL_MAX_OUTPUT_TOKENS[stripped];
    if (s !== undefined) return s;
  }
  if (key.startsWith('gpt-5.4')) return 128000;
  if (key.startsWith('gpt-5.2')) return 128000;
  if (key.startsWith('gpt-5.1')) return 128000;
  if (key.startsWith('gpt-5-mini')) return 128000;
  if (key.startsWith('gpt-5-nano')) return 128000;
  if (key.startsWith('gpt-5')) return 128000;
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * When no per-request reasoning effort is set, some GPT-5.x models expect a default effort for JSON schema calls.
 */
export function shouldApplyDefaultReasoningEffortNone(modelNameLower: string): boolean {
  return (
    modelNameLower === 'gpt-5.2' ||
    modelNameLower.startsWith('gpt-5.2-') ||
    modelNameLower === 'gpt-5.4' ||
    modelNameLower.startsWith('gpt-5.4-')
  );
}
