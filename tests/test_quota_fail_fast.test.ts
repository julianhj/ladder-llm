/**
 * Tests for insufficient_quota handling: fail-fast in tests and error normalization.
 */
import { normalizeAgentError, AGENT_ERROR_CODES } from '../src/recruitment/agents/errors';
import { failFastOnQuotaError } from './testUtils';
import type { StageResult } from '../src/recruitment/pipeline/PipelineRunner';

describe('insufficient_quota handling', () => {
  describe('normalizeAgentError', () => {
    it('returns insufficient_quota and non-retryable when code is insufficient_quota', () => {
      const err = new Error('429 quota exceeded') as Error & { code?: string };
      err.code = 'insufficient_quota';
      expect(normalizeAgentError(err)).toEqual({
        code: AGENT_ERROR_CODES.INSUFFICIENT_QUOTA,
        retryable: false,
      });
    });

    it('returns insufficient_quota when message contains quota and exceeded', () => {
      const err = new Error('429 You exceeded your current quota, please check your plan and billing details.');
      expect(normalizeAgentError(err)).toEqual({
        code: AGENT_ERROR_CODES.INSUFFICIENT_QUOTA,
        retryable: false,
      });
    });
  });

  describe('failFastOnQuotaError', () => {
    const originalExit = process.exit;

    afterEach(() => {
      process.exit = originalExit;
    });

    it('exits process with 1 when any result has error.code insufficient_quota', () => {
      const exitMock = jest.fn();
      process.exit = exitMock as unknown as typeof process.exit;
      const stageResults: StageResult[] = [
        {
          stageId: 'stage_1',
          stageName: 'Stage 1',
          results: [
            { success: true, agentId: 'a1', agentName: 'Agent 1', result: {} },
            {
              success: false,
              agentId: 'a2',
              agentName: 'Skill Formatter',
              error: { message: '429 quota', code: 'insufficient_quota', retryable: false },
            },
          ],
        },
      ];
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      failFastOnQuotaError(stageResults);
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(consoleSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('OpenAI API quota exceeded'))).toBe(true);
      expect(consoleSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('Stage 1') && m.includes('Skill Formatter'))).toBe(true);
      consoleSpy.mockRestore();
    });

    it('exits process with 1 when error message contains exceeded your current quota', () => {
      const exitMock = jest.fn();
      process.exit = exitMock as unknown as typeof process.exit;
      const stageResults: StageResult[] = [
        {
          stageId: 's1',
          stageName: 'Stage 15',
          results: [
            {
              success: false,
              agentId: 'x',
              agentName: 'CV Optimizer',
              error: {
                message: '429 You exceeded your current quota, please check your plan and billing details.',
                code: 'UNKNOWN',
              },
            },
          ],
        },
      ];
      jest.spyOn(console, 'error').mockImplementation();
      failFastOnQuotaError(stageResults);
      expect(exitMock).toHaveBeenCalledWith(1);
      (console.error as jest.Mock).mockRestore();
    });

    it('does not throw when all results succeeded', () => {
      const stageResults: StageResult[] = [
        {
          stageId: 's1',
          stageName: 'Stage 1',
          results: [
            { success: true, agentId: 'a1', agentName: 'A1', result: {} },
          ],
        },
      ];
      expect(() => failFastOnQuotaError(stageResults)).not.toThrow();
    });

    it('does not throw when failure has different error code', () => {
      const stageResults: StageResult[] = [
        {
          stageId: 's1',
          stageName: 'Stage 1',
          results: [
            {
              success: false,
              agentId: 'a1',
              agentName: 'A1',
              error: { message: 'Timeout', code: 'REQUEST_TIMEOUT', retryable: true },
            },
          ],
        },
      ];
      expect(() => failFastOnQuotaError(stageResults)).not.toThrow();
    });
  });
});
