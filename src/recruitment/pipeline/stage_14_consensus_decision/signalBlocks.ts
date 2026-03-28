import {
  SIGNAL_AGGREGATED_KEYS,
  SIGNAL_BLOCKS_KEYS,
} from '../../agents/schemas/index.js';

/** Map aggregated_signals keys (SIGNAL_AGGREGATED_KEYS) to signal_blocks keys (SIGNAL_BLOCKS_KEYS). Order must match. */
const AGGREGATED_TO_BLOCKS: Record<(typeof SIGNAL_AGGREGATED_KEYS)[number], (typeof SIGNAL_BLOCKS_KEYS)[number]> = {
  technical_scope: 'technical_depth',
  execution_authority: 'execution_maturity',
  leadership_impact: 'leadership_scope',
  delivery_risk: 'delivery_risk',
  business_alignment: 'business_alignment',
};

/** Map stage_4_signal_normalisation aggregated_signals to consensus signal_blocks using canonical dimension keys. */
function toSignalBlocks(
  aggregatedSignals: Record<string, unknown> | undefined
): Record<(typeof SIGNAL_BLOCKS_KEYS)[number], string[]> {
  const arr = (val: unknown): string[] =>
    Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
  const out = {} as Record<string, string[]>;
  for (const aggKey of SIGNAL_AGGREGATED_KEYS) {
    const blocksKey = AGGREGATED_TO_BLOCKS[aggKey];
    out[blocksKey] = arr(aggregatedSignals?.[aggKey]);
  }
  return out as Record<(typeof SIGNAL_BLOCKS_KEYS)[number], string[]>;
}

/** Build signal_blocks from stage_4_signal_normalisation result (aggregated_signals). */
export function getSignalBlocksFromSignalNormalisation(
  signalNormalisationResult: { result?: unknown } | undefined
): Record<(typeof SIGNAL_BLOCKS_KEYS)[number], string[]> {
  const result = signalNormalisationResult?.result;
  if (result == null || typeof result !== 'object') return toSignalBlocks(undefined);
  const agg = (result as Record<string, unknown>).aggregated_signals;
  return toSignalBlocks(agg as Record<string, unknown> | undefined);
}
