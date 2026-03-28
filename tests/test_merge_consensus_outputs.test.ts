import { getSignalBlocksFromSignalNormalisation } from '../src/recruitment/pipeline/stage_14_consensus_decision/signalBlocks.js';
import { SIGNAL_BLOCKS_KEYS } from '../src/recruitment/agents/schemas/index.js';

describe('stage_14 signalBlocks', () => {
  describe('getSignalBlocksFromSignalNormalisation', () => {
    it('maps stage_4 aggregated_signals to signal_blocks keys', () => {
      const signalNormResult = {
        result: {
          aggregated_signals: {
            technical_scope: ['Strong architecture'],
            execution_authority: ['Delivery track record'],
            leadership_impact: ['Led team of 5'],
            delivery_risk: [],
            business_alignment: ['Revenue impact'],
          },
        },
      };
      const blocks = getSignalBlocksFromSignalNormalisation(signalNormResult);
      expect(SIGNAL_BLOCKS_KEYS).toContain('technical_depth');
      expect(blocks.technical_depth).toEqual(['Strong architecture']);
      expect(blocks.execution_maturity).toEqual(['Delivery track record']);
      expect(blocks.leadership_scope).toEqual(['Led team of 5']);
      expect(blocks.delivery_risk).toEqual([]);
      expect(blocks.business_alignment).toEqual(['Revenue impact']);
    });

    it('returns empty arrays when result or aggregated_signals is missing', () => {
      const empty = getSignalBlocksFromSignalNormalisation(undefined);
      for (const key of SIGNAL_BLOCKS_KEYS) {
        expect(empty[key as keyof typeof empty]).toEqual([]);
      }
      const noAgg = getSignalBlocksFromSignalNormalisation({ result: {} });
      expect(noAgg.technical_depth).toEqual([]);
    });
  });
});
