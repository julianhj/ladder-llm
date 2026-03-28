import { aggregateTokenUsageByModel } from '../src/recruitment/utils/aggregateTokenUsageByModel';

describe('aggregateTokenUsageByModel', () => {
  it('groups rows by model and sums tokens', () => {
    const out = aggregateTokenUsageByModel([
      { model: 'gpt-5.2', inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      { model: 'gpt-5.4-mini', inputTokens: 50, outputTokens: 5, totalTokens: 55 },
      { model: 'gpt-5.2', inputTokens: 20, outputTokens: 2, totalTokens: 22 },
    ]);
    expect(out).toEqual([
      { model: 'gpt-5.2', inputTokens: 120, outputTokens: 12, totalTokens: 132 },
      { model: 'gpt-5.4-mini', inputTokens: 50, outputTokens: 5, totalTokens: 55 },
    ]);
  });

  it('uses unknownLabel when model is missing', () => {
    const out = aggregateTokenUsageByModel([
      { model: undefined, inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    ]);
    expect(out).toEqual([{ model: 'unknown', inputTokens: 1, outputTokens: 2, totalTokens: 3 }]);
  });
});
