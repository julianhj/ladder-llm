import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { getAgentBuilderDir } from './agentBuilderDir.js';

/**
 * Extract the first complete JSON value (object or array) from a string by matching braces.
 * Returns { parsed, trailing } so we can pretty-print the JSON part and keep trailing text (e.g. " IMPORTANT: ...").
 */
function parseLeadingJson(str: string): { parsed: unknown; trailing: string } | null {
  const trimmed = str.trim();
  if (trimmed.length < 2) return null;
  const open = trimmed[0];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (close === null) return null;
  let depth = 1;
  let i = 1;
  let inString: string | null = null;
  let escape = false;
  while (i < trimmed.length && depth > 0) {
    const c = trimmed[i];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (c === '\\' && inString !== null) {
      escape = true;
      i++;
      continue;
    }
    if (inString !== null) {
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  if (depth !== 0) return null;
  const jsonPart = trimmed.slice(0, i);
  const trailing = trimmed.slice(i).trimStart();
  try {
    return { parsed: JSON.parse(jsonPart), trailing };
  } catch {
    return null;
  }
}

function processParsedValue(parsed: unknown): unknown {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return tryParseJsonStringsInObject(parsed as Record<string, unknown>);
  }
  if (Array.isArray(parsed)) {
    return parsed.map((item) =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? tryParseJsonStringsInObject(item as Record<string, unknown>)
        : item
    );
  }
  return parsed;
}

/**
 * Recursively replace string values that are valid JSON (or leading JSON + trailing text) with parsed objects
 * so the log file is pretty-printed when stringified with indentation.
 */
function tryParseJsonStringsInObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
        try {
          result[key] = processParsedValue(JSON.parse(value));
        } catch {
          const leading = parseLeadingJson(value);
          if (leading) {
            result[key] = processParsedValue(leading.parsed);
            if (leading.trailing.length > 0) {
              result[`${key}_trailing`] = leading.trailing;
            }
          } else {
            result[key] = value;
          }
        }
      } else {
        result[key] = value;
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = tryParseJsonStringsInObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? tryParseJsonStringsInObject(item as Record<string, unknown>)
          : item
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deep-copy a request payload and parse any string values that are (or start with) JSON
 * so that when stringified with indentation the log file is pretty-printed.
 * Use for both agent and preprocessing request logs.
 */
export function prettyPrintRequestPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return tryParseJsonStringsInObject(
    JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
  ) as Record<string, unknown>;
}

/**
 * Write log file to disk with date/time folder structure.
 * Uses runId if available, otherwise falls back to current timestamp.
 * When stageId is present: files go under logs/date/time/<stageId>/requests|responses/ with filename agentId_timestamp.json.
 * When stageId is missing: files go under logs/date/time/requests|responses/ with sanitized stage_agent_timestamp.json.
 * Request logs: contain the exact payload sent to the OpenAI Responses API under the `payload` key.
 * Safe for parallel execution: no module-level state; all run context passed as arguments.
 */
export async function writeLogFile(
  content: string,
  agentName: string,
  stageName: string | undefined,
  type: 'request' | 'response',
  runId: string | null,
  metadata?: Record<string, any>,
  requestParams?: Record<string, unknown> | null,
  agentId?: string,
  stageId?: string
): Promise<string> {
  try {
    const agentBuilderDir = getAgentBuilderDir();
    const now = new Date();

    let dateStr: string;
    let timeStr: string;
    if (runId) {
      if (runId.includes('T')) {
        const parts = runId.split('T');
        dateStr = parts[0];
        timeStr = parts[1];
      } else {
        dateStr = now.toISOString().split('T')[0];
        timeStr = runId;
      }
    } else {
      dateStr = now.toISOString().split('T')[0];
      timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    }

    const logsBaseDir = path.resolve(agentBuilderDir, '../../../logs');
    const dateDir = path.join(logsBaseDir, dateStr);
    const timeDir = path.join(dateDir, timeStr);
    const typeDir =
      stageId != null
        ? path.join(timeDir, stageId, type === 'request' ? 'requests' : 'responses')
        : path.join(timeDir, type === 'request' ? 'requests' : 'responses');

    try {
      await mkdir(typeDir, { recursive: true });
    } catch (mkdirError) {
      if ((mkdirError as any).code !== 'EEXIST') {
        throw mkdirError;
      }
    }

    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename =
      stageId != null && agentId != null
        ? `${agentId}_${timestamp}.json`
        : (() => {
            const sanitizedAgentName = agentName.replace(/[^a-zA-Z0-9_-]/g, '_');
            const shortStageLabel = stageName
              ? stageName.replace(/^Stage\s+/i, '').replace(/\s*-\s*/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_') || 'stage'
              : 'stage';
            return `${shortStageLabel}_${sanitizedAgentName}_${timestamp}.json`;
          })();
    const filePath = path.join(typeDir, filename);

    const baseMeta = {
      agentId: agentId ?? null,
      agentName,
      stageId: stageId ?? null,
      stageName: stageName || null,
      type,
      timestamp: now.toISOString(),
      runId: runId || null,
      metadata: metadata || {},
    };

    // For request logs, parse any payload string values that are valid JSON so the file is pretty-printed
    let payloadForLog: Record<string, unknown> | undefined;
    if (type === 'request' && requestParams && typeof requestParams === 'object') {
      payloadForLog = prettyPrintRequestPayload(requestParams);
    }

    // For response logs, pretty-print rawResponse: parse JSON strings so the file is written with indentation
    let rawResponseValue: unknown = content;
    if (type === 'response' && typeof content === 'string' && content.trim().length > 0) {
      try {
        let parsed: unknown = JSON.parse(content);
        // Handle double-encoded JSON (string that parses to another JSON string)
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          const first = parsed.trim()[0];
          if (first === '{' || first === '[') {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // use string as-is
            }
          }
        }
        if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
          rawResponseValue = parsed;
        }
      } catch {
        // keep as string if not valid JSON
      }
    }
    const logContent: Record<string, unknown> =
      type === 'request'
        ? { ...baseMeta, payload: payloadForLog ?? requestParams ?? {} }
        : { ...baseMeta, content: { rawResponse: rawResponseValue } };

    await writeFile(filePath, JSON.stringify(logContent, null, 2), 'utf-8');

    Logger.debug('AgentBuilder', `Logged ${type} to file`, {
      agentId: agentId ?? undefined,
      agentName,
      stageId: stageId ?? undefined,
      stageName,
      filePath,
      contentLength: type === 'request' ? 0 : content.length,
      runId: runId || 'none',
    });

    return filePath;
  } catch (error) {
    Logger.warn('AgentBuilder', `Failed to write log file for ${type}`, {
      agentId: agentId ?? undefined,
      agentName,
      stageId: stageId ?? undefined,
      stageName,
      error: (error as Error).message,
    });
    return '';
  }
}
