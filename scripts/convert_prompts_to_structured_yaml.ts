/**
 * Converts prompt YAML files from prompt: | (string) to prompt: { role, objective, inputs, rules, ... } (structured object).
 * Skips files where prompt is already an object. Excludes old/ and non-prompt files.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const PROMPTS_DIR = join(__dirname, '../prompts');

function findAllYaml(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'old' || name === 'configs' || name === 'config') continue;
    if (statSync(full).isDirectory()) findAllYaml(full, acc);
    else if (name.endsWith('.yaml') && !name.includes('settings')) acc.push(full);
  }
  return acc;
}

interface ParsedYaml {
  version?: string;
  lastModified?: string;
  description?: string;
  prompt: unknown;
}

function extractRole(text: string): string | null {
  const m = text.match(/You are (?:a|an) ([^.\n]+?)(?:\.|\.\s|\n)/i);
  return m ? m[1].trim() : null;
}

function splitSections(text: string): { header: string; body: string }[] {
  const sections: { header: string; body: string }[] = [];
  // Split on --- or on lines that look like section headers (ALL CAPS, or "Section Name", or "STEP N - Name")
  const parts = text.split(/\n\s*---\s*\n/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // First line as header if it's short and looks like a title (all caps, or title case)
    const lines = trimmed.split('\n');
    const firstLine = lines[0].trim();
    const isHeader =
      firstLine.length < 80 &&
      (firstLine === firstLine.toUpperCase() ||
        /^[A-Z][a-z].*[A-Z]/.test(firstLine) ||
        /^(Step|Inputs?|Rules?|Output|Instructions?|Responsibilities?|Prohibitions?|Context)/i.test(firstLine));
    if (isHeader && lines.length > 1) {
      const header = firstLine;
      const body = lines.slice(1).join('\n').trim();
      sections.push({ header, body });
    } else {
      sections.push({ header: 'content', body: trimmed });
    }
  }
  return sections;
}

function headerToKey(header: string): string {
  const s = header
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
  if (s === 'content' || s === '') return 'objective';
  const mapping: Record<string, string> = {
    role_and_objective: 'objective',
    system: 'objective',
    inputs: 'inputs',
    input_sources: 'inputs',
    instructions: 'objective',
    rules: 'rules',
    prohibitions: 'rules',
    responsibilities: 'rules',
    output_requirements: 'output_requirements',
    output: 'output_requirements',
    output_strict: 'output_requirements',
    final_instruction: 'final_instruction',
    stop_conditions: 'final_instruction',
  };
  return mapping[s] || s;
}

function parseInputsBlock(body: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon > 0) {
      const key = trimmed.slice(0, colon).trim().replace(/\s+/g, '_');
      const value = trimmed.slice(colon + 1).trim();
      if (key && value) inputs[key] = value;
    } else {
      const key = trimmed.replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '');
      if (key) inputs[key] = trimmed;
    }
  }
  return inputs;
}

function parseRulesBlock(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function parseOutputRequirements(body: string): { format: string; constraints: string[] } {
  const constraints: string[] = [];
  let format = 'JSON only';
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^format:/i.test(t)) format = t.replace(/^format:\s*/i, '').trim();
    else if (t.startsWith('-')) constraints.push(t.slice(1).trim());
    else if (/do not add|do not include|output only/i.test(t)) constraints.push(t);
  }
  if (constraints.length === 0 && /do not|output only|padding|newlines/i.test(body)) {
    body.split(/[.\n]/).forEach((s) => {
      const x = s.trim();
      if (x && /do not|output only|padding|newlines|closing brace/i.test(x)) constraints.push(x + '.');
    });
  }
  return { format, constraints: constraints.length ? constraints : [body.trim()] };
}

function parseOutputSchema(body: string): { type: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const colon = t.indexOf(':');
    if (colon > 0) {
      const key = t.slice(0, colon).trim();
      const value = t.slice(colon + 1).trim();
      if (key && !key.startsWith('Example') && !key.startsWith('RichText')) fields[key] = value;
    }
  }
  return { type: 'object', fields: Object.keys(fields).length ? fields : { schema: body.trim() } };
}

function promptStringToStructure(promptText: string, defaultRole?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const role = extractRole(promptText) || defaultRole || 'Agent';
  out.role = role;

  const sections = splitSections(promptText);
  let objectiveParts: string[] = [];
  const rules: string[] = [];
  let outputRequirements: { format: string; constraints: string[] } | null = null;
  let outputSchema: { type: string; fields: Record<string, string> } | null = null;
  let finalInstruction: string | null = null;
  const inputs: Record<string, string> = {};
  const other: Record<string, string> = {};

  for (const { header, body } of sections) {
    const key = headerToKey(header);
    const lowerBody = body.toLowerCase();
    if (key === 'objective' || (key === 'content' && !out.objective)) {
      objectiveParts.push(body);
    } else if (key === 'inputs') {
      Object.assign(inputs, parseInputsBlock(body));
    } else if (key === 'rules') {
      rules.push(...parseRulesBlock(body));
    } else if (key === 'output_requirements' || (lowerBody.includes('output only') && lowerBody.includes('json'))) {
      outputRequirements = parseOutputRequirements(body);
    } else if (key === 'output_schema' || /return a json object with|json object with:/.test(lowerBody)) {
      outputSchema = parseOutputSchema(body);
    } else if (key === 'final_instruction' || /no other text before or after/.test(lowerBody)) {
      finalInstruction = body.trim();
    } else {
      other[headerToKey(header)] = body.trim();
    }
  }

  if (objectiveParts.length) out.objective = objectiveParts.join('\n\n').trim();
  if (Object.keys(inputs).length) out.inputs = inputs;
  if (rules.length) out.rules = rules;
  if (outputRequirements) out.output_requirements = outputRequirements;
  if (outputSchema) out.output_schema = outputSchema;
  if (finalInstruction) out.final_instruction = finalInstruction;
  Object.assign(out, other);

  return out;
}

function convertFile(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(content, { schema: 'core' }) as ParsedYaml | null;
  if (!parsed || typeof parsed.prompt !== 'string') return false;

  const promptObj = promptStringToStructure(parsed.prompt);
  const baseName = filePath.replace(/.*[/\\]/, '').replace(/\.yaml$/, '').replace(/\.v\d+\.\d+\.\d+$/, '');
  const defaultRole = baseName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const out: Record<string, unknown> = {
    ...(parsed.version && { version: parsed.version }),
    ...(parsed.lastModified && { lastModified: parsed.lastModified }),
    ...(parsed.description && { description: parsed.description }),
    prompt: promptObj,
  };

  const yamlOut = stringifyYaml(out, {
    lineWidth: 0,
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  });
  writeFileSync(filePath, yamlOut, 'utf-8');
  return true;
}

function main() {
  const files = findAllYaml(PROMPTS_DIR);
  let converted = 0;
  for (const f of files) {
    try {
      if (convertFile(f)) {
        converted++;
        console.log('Converted:', f.replace(PROMPTS_DIR + '/', ''));
      }
    } catch (e) {
      console.error('Error', f, e);
    }
  }
  console.log('Total converted:', converted);
}

main();
