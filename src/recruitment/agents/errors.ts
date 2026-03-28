/** Stable error codes for UI consumption (timeout, truncation, parse, etc.). */
export const AGENT_ERROR_CODES = {
  TRUNCATED_RESPONSE: 'TRUNCATED_RESPONSE',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  BACKGROUND_STAGE_TIMEOUT: 'BACKGROUND_STAGE_TIMEOUT',
  JSON_PARSE_ERROR: 'JSON_PARSE_ERROR',
  STRUCTURED_EXTRACT_ERROR: 'STRUCTURED_EXTRACT_ERROR',
  INSUFFICIENT_QUOTA: 'insufficient_quota',
  UNKNOWN: 'UNKNOWN',
} as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

/**
 * Normalizes an agent error to a stable code and retryable flag for UI and logging.
 * Call before rethrowing so PipelineRunner and frontend receive consistent codes.
 */
export function normalizeAgentError(error: Error): { code: string; retryable: boolean } {
  const existingCode = (error as any).code;
  const existingRetryable = (error as any).retryable;
  const msg = (error.message || '').toLowerCase();
  const name = (error as any).name || '';

  if (existingCode && Object.values(AGENT_ERROR_CODES).includes(existingCode as AgentErrorCode)) {
    return {
      code: existingCode,
      retryable:
        existingCode === AGENT_ERROR_CODES.INSUFFICIENT_QUOTA
          ? false
          : typeof existingRetryable === 'boolean' ? existingRetryable : true,
    };
  }

  if (existingCode === 'BACKGROUND_STAGE_TIMEOUT') {
    return { code: AGENT_ERROR_CODES.BACKGROUND_STAGE_TIMEOUT, retryable: true };
  }

  if (name === 'AbortError' || msg.includes('abort') || msg.includes('timed out') || msg.includes('timeout') || existingCode === 'ETIMEDOUT') {
    return { code: AGENT_ERROR_CODES.REQUEST_TIMEOUT, retryable: true };
  }

  if (existingCode === 'TRUNCATED_RESPONSE' || msg.includes('truncat') || msg.includes('max_output_tokens')) {
    return { code: AGENT_ERROR_CODES.TRUNCATED_RESPONSE, retryable: true };
  }

  if (existingCode === 'JSON_PARSE_ERROR' || (msg.includes('json') && (msg.includes('parse') || msg.includes('unterminated') || msg.includes('unexpected end')))) {
    return { code: AGENT_ERROR_CODES.JSON_PARSE_ERROR, retryable: true };
  }

  if (existingCode === 'STRUCTURED_EXTRACT_ERROR') {
    return { code: AGENT_ERROR_CODES.STRUCTURED_EXTRACT_ERROR, retryable: false };
  }

  if (
    existingCode === AGENT_ERROR_CODES.INSUFFICIENT_QUOTA ||
    msg.includes('insufficient_quota') ||
    (msg.includes('quota') && msg.includes('exceeded'))
  ) {
    return { code: AGENT_ERROR_CODES.INSUFFICIENT_QUOTA, retryable: false };
  }

  return {
    code: existingCode && typeof existingCode === 'string' ? existingCode : AGENT_ERROR_CODES.UNKNOWN,
    retryable: typeof existingRetryable === 'boolean' ? existingRetryable : false,
  };
}
