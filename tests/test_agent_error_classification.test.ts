import {
  normalizeAgentError,
  AGENT_ERROR_CODES,
} from '../src/recruitment/agents/AgentBuilder';

describe('normalizeAgentError', () => {
  it('returns existing stable code and retryable when error already has a known code', () => {
    const err = new Error('Truncated') as Error & { code?: string; retryable?: boolean };
    err.code = AGENT_ERROR_CODES.TRUNCATED_RESPONSE;
    err.retryable = true;
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.TRUNCATED_RESPONSE,
      retryable: true,
    });
  });

  it('maps AbortError to REQUEST_TIMEOUT and retryable', () => {
    const err = new Error('The operation was aborted') as Error & { name?: string };
    err.name = 'AbortError';
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.REQUEST_TIMEOUT,
      retryable: true,
    });
  });

  it('maps timeout message to REQUEST_TIMEOUT', () => {
    const err = new Error('Request timed out after 60s');
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.REQUEST_TIMEOUT,
      retryable: true,
    });
  });

  it('maps ETIMEDOUT code to REQUEST_TIMEOUT', () => {
    const err = new Error('connect ETIMEDOUT') as Error & { code?: string };
    err.code = 'ETIMEDOUT';
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.REQUEST_TIMEOUT,
      retryable: true,
    });
  });

  it('maps BACKGROUND_STAGE_TIMEOUT as-is', () => {
    const err = new Error('Background stage exceeded wait limit') as Error & { code?: string };
    err.code = 'BACKGROUND_STAGE_TIMEOUT';
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.BACKGROUND_STAGE_TIMEOUT,
      retryable: true,
    });
  });

  it('maps truncation message to TRUNCATED_RESPONSE', () => {
    const err = new Error('Response was truncated due to max_output_tokens limit');
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.TRUNCATED_RESPONSE,
      retryable: true,
    });
  });

  it('maps JSON parse message to JSON_PARSE_ERROR', () => {
    const err = new Error('Unexpected end of JSON input');
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.JSON_PARSE_ERROR,
      retryable: true,
    });
  });

  it('returns STRUCTURED_EXTRACT_ERROR and non-retryable when code set', () => {
    const err = new Error('Failed to extract') as Error & { code?: string; retryable?: boolean };
    err.code = AGENT_ERROR_CODES.STRUCTURED_EXTRACT_ERROR;
    err.retryable = false;
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.STRUCTURED_EXTRACT_ERROR,
      retryable: false,
    });
  });

  it('returns UNKNOWN for unrecognized errors', () => {
    const err = new Error('Something else');
    expect(normalizeAgentError(err)).toEqual({
      code: AGENT_ERROR_CODES.UNKNOWN,
      retryable: false,
    });
  });
});
