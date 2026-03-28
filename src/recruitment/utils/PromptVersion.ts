/**
 * Prompt Versioning Utilities
 *
 * Manages versioning for prompt files and agent configurations.
 * Uses semantic versioning (semver) format: major.minor.patch
 *
 * Version-based file naming: {base}.v{version}.yaml
 * Example: stage_3_interviews/technical_interviewer.v1.0.0.yaml
 */

import { parse as parseYaml } from 'yaml';

const NEWLINE_REGEX = /\r\n|\r|\n/g;

/**
 * Recursively replace all newline characters in string values with a single space so that
 * JSON.stringify output contains no \n. Mutates the object in place. Use for prompt objects before stringifying.
 */
export function replaceNewlinesInStrings(obj: unknown): void {
  if (typeof obj === 'string') {
    return; // caller must assign: we can't mutate string primitives
  }
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (typeof val === 'string') {
        record[key] = val.replace(NEWLINE_REGEX, ' ').replace(/\s{2,}/g, ' ');
      } else {
        replaceNewlinesInStrings(val);
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item === 'string') {
        obj[i] = item.replace(NEWLINE_REGEX, ' ').replace(/\s{2,}/g, ' ');
      } else {
        replaceNewlinesInStrings(item);
      }
    }
  }
}

export interface PromptMetadata {
  version: string;
  lastModified?: string;
  description?: string;
}

export interface VersionInfo {
  promptFile: string;
  version: string;
  expectedVersion?: string;
  isValid: boolean;
}

export interface ParsedPromptYaml {
  metadata: PromptMetadata;
  prompt: string;
}

export interface ParsedPromptYamlToObject {
  metadata: PromptMetadata;
  promptObject: Record<string, unknown>;
}

/**
 * Parses a YAML prompt file and returns metadata and the prompt as a plain object (no string rendering).
 * Use this for the JSON prompt pipeline so the builder can merge keys without regex/whitespace.
 * If the YAML has prompt as a string, it is returned as { content: prompt }. If it is already an object, it is returned as-is (shallow copy).
 */
export function parsePromptYamlToObject(content: string): ParsedPromptYamlToObject {
  const parsed = parseYaml(content, { schema: 'core' }) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Prompt YAML must be an object');
  }
  const promptRaw = parsed['prompt'];
  let promptObject: Record<string, unknown>;
  if (typeof promptRaw === 'string') {
    promptObject = { content: promptRaw };
  } else if (promptRaw && typeof promptRaw === 'object' && !Array.isArray(promptRaw)) {
    promptObject = { ...(promptRaw as Record<string, unknown>) };
  } else {
    throw new Error('Prompt YAML must have a "prompt" field (string or structured object)');
  }
  const version = parsed['version'];
  const metadata: PromptMetadata = {
    version: typeof version === 'string' ? version : '',
  };
  if (typeof parsed['lastModified'] === 'string') {
    metadata.lastModified = parsed['lastModified'];
  }
  if (typeof parsed['description'] === 'string') {
    metadata.description = parsed['description'];
  }
  return { metadata, promptObject };
}

/**
 * Renders a structured prompt object (role, objective, inputs, rules, etc.) into a single string for the model.
 */
export function renderStructuredPrompt(promptObj: Record<string, unknown>): string {
  const lines: string[] = [];

  const pushSection = (title: string, body: string) => {
    if (!body.trim()) return;
    lines.push(title);
    lines.push('');
    lines.push(body.trim());
    lines.push('');
  };

  if (typeof promptObj['role'] === 'string') {
    pushSection('Role', promptObj['role']);
  }

  if (typeof promptObj['objective'] === 'string') {
    pushSection('Objective', promptObj['objective']);
  }

  if (promptObj['inputs'] && typeof promptObj['inputs'] === 'object' && !Array.isArray(promptObj['inputs'])) {
    const inputs = promptObj['inputs'] as Record<string, string>;
    const body = Object.entries(inputs)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    pushSection('Inputs', body);
  }

  if (Array.isArray(promptObj['rules'])) {
    const body = (promptObj['rules'] as unknown[])
      .filter((r): r is string => typeof r === 'string')
      .map((r) => `- ${r}`)
      .join('\n');
    pushSection('Rules', body);
  }

  if (promptObj['output_requirements'] && typeof promptObj['output_requirements'] === 'object') {
    const oreq = promptObj['output_requirements'] as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof oreq['format'] === 'string') {
      parts.push(`Format: ${oreq['format']}`);
    }
    if (Array.isArray(oreq['constraints'])) {
      parts.push(
        'Constraints:',
        ...(oreq['constraints'] as string[]).map((c) => `- ${c}`)
      );
    }
    pushSection('Output requirements', parts.join('\n'));
  }

  // output_schema is no longer rendered from prompt YAML; schema is injected at runtime (Zod → JSON schema).

  if (typeof promptObj['final_instruction'] === 'string') {
    pushSection('Final instruction', promptObj['final_instruction']);
  }

  if (Array.isArray(promptObj['research_standards'])) {
    const body = (promptObj['research_standards'] as unknown[])
      .filter((r): r is string => typeof r === 'string')
      .map((r) => `- ${r}`)
      .join('\n');
    pushSection('Research standards', body);
  }

  if (typeof promptObj['sections'] === 'string') {
    pushSection('Sections', promptObj['sections']);
  }

  if (Array.isArray(promptObj['instructions'])) {
    const body = (promptObj['instructions'] as unknown[])
      .filter((r): r is string => typeof r === 'string')
      .map((r) => `- ${r}`)
      .join('\n');
    pushSection('Instructions', body);
  }

  // Any other top-level keys under prompt (e.g. context, steps) rendered generically
  const knownKeys = new Set([
    'role',
    'objective',
    'inputs',
    'rules',
    'output_requirements',
    'output_schema', // Ignored: schema is injected at runtime (Zod → JSON); do not render from YAML
    'final_instruction',
    'research_standards',
    'sections',
    'instructions',
  ]);
  for (const [key, value] of Object.entries(promptObj)) {
    if (knownKeys.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      pushSection(key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), value);
    } else if (Array.isArray(value)) {
      const body = value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => `- ${v}`)
        .join('\n');
      pushSection(key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), body);
    } else if (typeof value === 'object') {
      const body = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n');
      pushSection(key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), body);
    }
  }

  return lines.join('\n').trim();
}

/**
 * Parses a YAML prompt file and returns metadata and prompt body.
 * Prompt can be a string (legacy) or a structured object (role, objective, inputs, rules, etc.); objects are rendered to a single string.
 */
export function parsePromptYaml(content: string): ParsedPromptYaml {
  const parsed = parseYaml(content, { schema: 'core' }) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Prompt YAML must be an object');
  }
  const promptRaw = parsed['prompt'];
  let prompt: string;
  if (typeof promptRaw === 'string') {
    prompt = promptRaw;
  } else if (promptRaw && typeof promptRaw === 'object' && !Array.isArray(promptRaw)) {
    prompt = renderStructuredPrompt(promptRaw as Record<string, unknown>);
  } else {
    throw new Error('Prompt YAML must have a "prompt" field (string or structured object)');
  }
  const version = parsed['version'];
  const metadata: PromptMetadata = {
    version: typeof version === 'string' ? version : '',
  };
  if (typeof parsed['lastModified'] === 'string') {
    metadata.lastModified = parsed['lastModified'];
  }
  if (typeof parsed['description'] === 'string') {
    metadata.description = parsed['description'];
  }
  return { metadata, prompt };
}

/**
 * Validates a semantic version string
 */
export function isValidVersion(version: string): boolean {
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(version);
}

/**
 * Compares two semantic versions
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  if (!isValidVersion(v1) || !isValidVersion(v2)) {
    throw new Error(`Invalid version format: ${v1} or ${v2}`);
  }

  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (parts1[i] < parts2[i]) return -1;
    if (parts1[i] > parts2[i]) return 1;
  }

  return 0;
}

/**
 * Validates that a prompt version matches the expected version
 */
export function validatePromptVersion(
  promptFile: string,
  actualVersion: string,
  expectedVersion?: string
): VersionInfo {
  const isValid = !expectedVersion || actualVersion === expectedVersion;

  return {
    promptFile,
    version: actualVersion,
    expectedVersion,
    isValid,
  };
}

/**
 * Constructs a prompt file path with version
 * Format: {base}.v{version}.yaml
 */
export function constructPromptFilePath(promptBase: string, version: string): string {
  if (!isValidVersion(version)) {
    throw new Error(`Invalid version format: ${version}. Expected semver format (e.g., 1.0.0)`);
  }

  const baseWithoutExt = promptBase.replace(/\.(yaml|yml|md)$/, '');
  return `${baseWithoutExt}.v${version}.yaml`;
}

/**
 * Extracts version from a filename
 * Example: "stage_3_interviews/technical_interviewer.v1.0.0.yaml" -> "1.0.0"
 * Returns null if no version found
 */
export function extractVersionFromFilename(filename: string): string | null {
  const versionMatch = filename.match(/\.v(\d+\.\d+\.\d+)\.yaml$/);
  return versionMatch ? versionMatch[1] : null;
}

/**
 * Gets the base path from a versioned filename
 * Example: "stage_3_interviews/technical_interviewer.v1.0.0.yaml" -> "stage_3_interviews/technical_interviewer"
 */
export function getPromptBaseFromFilename(filename: string): string {
  return filename.replace(/\.v\d+\.\d+\.\d+\.yaml$/, '');
}
