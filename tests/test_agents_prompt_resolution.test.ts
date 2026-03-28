/**
 * Ensures every prompt referenced in agents.json exists on disk at the path
 * that AgentBuilder would use (promptBase + version -> {promptBase}.v{version}.yaml).
 * Run this after changing agents.json or moving/renaming prompt files.
 */
import { existsSync } from 'fs';
import path from 'path';
import { constructPromptFilePath, isValidVersion } from '../src/recruitment/utils/PromptVersion';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';

const promptsDir = path.resolve(__dirname, '../prompts');

async function loadAgentsConfig() {
  return ConfigLoader.loadAgentsConfig();
}

describe('agents.json prompt resolution', () => {
  it('all prompt files referenced in agents.json exist on disk', async () => {
    const config = await loadAgentsConfig();
    const missing: string[] = [];

    for (const stage of config.stages ?? []) {
      for (const agent of stage.agents ?? []) {
        const { name, promptBase, version } = agent;
        if (!promptBase || !version) continue;

        if (!isValidVersion(version)) {
          missing.push(`${stage.name} / ${name}: invalid version "${version}"`);
          continue;
        }

        const fileName = constructPromptFilePath(promptBase, version);
        const fullPath = path.join(promptsDir, fileName);
        if (!existsSync(fullPath)) {
          missing.push(`${stage.name} / ${name}: ${fileName} (resolved: ${fullPath})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('lists all agents and their prompt paths for debugging', async () => {
    const config = await loadAgentsConfig();
    const entries: Array<{ stage: string; agent: string; promptFile: string; exists: boolean }> = [];

    for (const stage of config.stages ?? []) {
      for (const agent of stage.agents ?? []) {
        const { name, promptBase, version } = agent;
        if (!promptBase || !version) continue;
        if (!isValidVersion(version)) continue;

        const fileName = constructPromptFilePath(promptBase, version);
        const fullPath = path.join(promptsDir, fileName);
        entries.push({
          stage: stage.name,
          agent: name,
          promptFile: fileName,
          exists: existsSync(fullPath),
        });
      }
    }

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.exists)).toBe(true);
  });
});
