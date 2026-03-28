/**
 * Parse JSON from model output; on failure try repairing common issues (unquoted keys, trailing commas).
 */
export function parseJsonFromModel(text: string): unknown {
  const tryParse = (candidate: string): unknown => JSON.parse(candidate);

  try {
    return tryParse(text);
  } catch (first) {
    const withoutCodeFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (withoutCodeFences !== text) {
      try {
        return tryParse(withoutCodeFences);
      } catch {
        // Continue with repair attempts below
      }
    }

    const msg = (first as Error).message || '';
    const needsQuotedKeys = msg.includes('property name') || msg.includes('double-quoted');
    const needsNoTrailingComma = msg.includes('Unexpected token') || msg.includes('position');

    if (needsQuotedKeys || needsNoTrailingComma) {
      try {
        let repaired = withoutCodeFences;
        if (needsNoTrailingComma) {
          repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
        }
        if (needsQuotedKeys) {
          // Quote unquoted keys: after { or , (existing), and at start of line (common in long model output)
          repaired = repaired.replace(/([\{\,]\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/g, '$1"$2":');
          repaired = repaired.replace(/(\n\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/g, '$1"$2":');
          // Second pass in case first pass introduced new unquoted keys or we have multiple in a row
          repaired = repaired.replace(/([\{\,]\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/g, '$1"$2":');
        }
        return tryParse(repaired);
      } catch {
        // Continue to JSON-boundary extraction
      }
    }

    const firstObject = withoutCodeFences.indexOf('{');
    const firstArray = withoutCodeFences.indexOf('[');
    const hasObject = firstObject >= 0;
    const hasArray = firstArray >= 0;
    const startsWithArray = hasArray && (!hasObject || firstArray < firstObject);
    const start = startsWithArray ? firstArray : firstObject;
    const end = startsWithArray
      ? withoutCodeFences.lastIndexOf(']')
      : withoutCodeFences.lastIndexOf('}');

    if (start >= 0 && end > start) {
      const sliced = withoutCodeFences.slice(start, end + 1);
      try {
        return tryParse(sliced);
      } catch {
        // Try brace-balanced extraction in case trailing content broke lastIndexOf
        if (!startsWithArray && firstObject >= 0) {
          const balanced = extractBalancedObject(withoutCodeFences, firstObject);
          if (balanced !== null) {
            try {
              return tryParse(balanced);
            } catch {
              // Fall through
            }
          }
        }
      }
    }

    throw first;
  }
}

/**
 * If the value is a string that looks like a JSON array of rich-text blocks
 * (e.g. "[{\"type\":\"paragraph\",\"text\":\"...\"}]" or ":[...]"), parse it and return the array.
 * Otherwise return null so the caller keeps the original value.
 * Use this to convert LLM output that accidentally stringified summary/description into proper JSON.
 */
export function tryParseJsonArrayFromString(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (s.startsWith(':')) s = s.slice(1).trim();
  if (!s.startsWith('[') || (!s.includes('"type"') && !s.includes("'type'"))) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract a substring from the first `{` to its matching `}` by counting braces.
 * Handles nested objects so trailing or leading text does not break extraction.
 */
function extractBalancedObject(text: string, startIndex: number): string | null {
  if (text.charAt(startIndex) !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = '';
  for (let i = startIndex; i < text.length; i++) {
    const c = text.charAt(i);
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}
