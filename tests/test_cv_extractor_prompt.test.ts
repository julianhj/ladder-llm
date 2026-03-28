import { readFile } from 'fs/promises';
import path from 'path';
import {
  CV_EXTRACTOR_PROMPT_VERSION,
  CV_EXTRACTOR_PROMPT_FILE,
} from '../src/recruitment/preprocessing/PreprocessingAgent';
import { parsePromptYaml, parsePromptYamlToObject, replaceNewlinesInStrings } from '../src/recruitment/utils/PromptVersion';
import { loadCommonPromptFragments } from '../src/recruitment/agents/promptLoader';

describe('CV extractor prompt (preprocessing regression)', () => {
  it('uses full-role preservation prompt version', () => {
    expect(CV_EXTRACTOR_PROMPT_VERSION).toBe('1.2.2');
    expect(CV_EXTRACTOR_PROMPT_FILE).toBe('cv_extractor.v1.2.3.yaml');
  });

  it('prompt does not enforce a "last N roles" limit', async () => {
    const promptPath = path.resolve(
      process.cwd(),
      'prompts',
      'preprocessing',
      CV_EXTRACTOR_PROMPT_FILE
    );
    const content = await readFile(promptPath, 'utf-8');
    const { prompt } = parsePromptYaml(content);
    const lower = prompt.toLowerCase();
    // Regression: old prompt said "For each of the last 4 roles"
    expect(lower).not.toMatch(/last\s+4\s+roles?/);
    expect(lower).not.toMatch(/only\s+the\s+last\s+\d+\s+roles?/);
    expect(lower).not.toMatch(/first\s+4\s+roles?/);
    // New prompt must require all roles
    expect(prompt).toMatch(/each\s+experience\s+role|every\s+source\s+role|include\s+every/i);
  });

  it('builds instructions as well-formed JSON with json_output_format', async () => {
    const promptPath = path.resolve(process.cwd(), 'prompts', 'preprocessing', CV_EXTRACTOR_PROMPT_FILE);
    const rawContent = await readFile(promptPath, 'utf-8');
    const { promptObject: parsedObject } = parsePromptYamlToObject(rawContent);
    const agentBuilderDir = path.resolve(process.cwd(), 'src', 'agents');
    const fragments = await loadCommonPromptFragments(agentBuilderDir);
    const merged: Record<string, unknown> = { system: 'You are an expert.', ...parsedObject };
    if (fragments.jsonOutputFormat?.trim()) {
      merged.json_output_format = fragments.jsonOutputFormat.trim();
    }
    replaceNewlinesInStrings(merged);
    const instructions = JSON.stringify(merged);
    const parsed = JSON.parse(instructions) as Record<string, unknown>;
    expect(parsed).toHaveProperty('system');
    expect(parsed).toHaveProperty('role');
    expect(parsed).toHaveProperty('json_output_format');
    expect(typeof parsed.json_output_format).toBe('string');
  });
});
