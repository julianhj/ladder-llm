import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

interface AgentInputRefObject {
  from: string;
  stageId?: string;
  stageIds?: string[];
  field?: string;
}

interface AgentConfig {
  id: string;
  name: string;
  inputFiles?: {
    previousStageResults?: string;
  };
  inputs?: Record<string, boolean | AgentInputRefObject>;
}

interface StageConfig {
  id: string;
  name: string;
  agents: AgentConfig[];
}

interface AgentsConfig {
  parallelStageGroups?: string[][];
  stages: StageConfig[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentsPath = path.resolve(__dirname, '../configs/agents.json');

const config = JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) as AgentsConfig;

const stageIds = config.stages.map(stage => stage.id);
const stageIndex = new Map<string, number>(stageIds.map((id, index) => [id, index]));

const backgroundStageId = stageIds.find(id => id.includes('background')) ?? null;

const dependencies = new Map<string, Set<string>>();
const agentDependencies = new Map<string, Map<string, Set<string>>>();
const missingDependencies = new Map<string, Set<string>>();
const futureDependencies = new Map<string, Set<string>>();

const contextKeyDependencies: Record<string, string[]> = {
  consensus_feedback: ['stage_14_consensus_decision'],
  recruiter_reality_output: ['stage_12_recruiter_reality_validator'],
  seniority_signal_enforcement: ['stage_13_seniority_signal_enforcement'],
  evidence_signals: ['stage_6_evidence_synthesiser'],
  signal_layer: ['stage_8_panel_weighting'],
  compact_signal_summary: ['stage_4_signal_normalisation', 'stage_6_evidence_synthesiser', 'stage_8_panel_weighting'],
};

const stageDependencyOverrides: Record<string, string[]> = {
  stage_9_signal_confidence_aggregation: [
    'stage_5_interview_calibration',
    'stage_6_evidence_synthesiser',
    'stage_8_panel_weighting',
  ],
};

const ensureSet = (map: Map<string, Set<string>>, key: string): Set<string> => {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Set<string>();
  map.set(key, created);
  return created;
};

const addDependency = (stageId: string, dependsOn: string | null | undefined) => {
  if (!dependsOn || dependsOn === stageId) return;
  const deps = ensureSet(dependencies, stageId);
  deps.add(dependsOn);
  if (!stageIndex.has(dependsOn)) {
    ensureSet(missingDependencies, stageId).add(dependsOn);
    return;
  }
  const stagePos = stageIndex.get(stageId) ?? 0;
  const depPos = stageIndex.get(dependsOn) ?? 0;
  if (depPos > stagePos) {
    ensureSet(futureDependencies, stageId).add(dependsOn);
  }
};

for (const stage of config.stages) {
  const stageDeps = ensureSet(dependencies, stage.id);
  const stageAgentDeps = new Map<string, Set<string>>();
  agentDependencies.set(stage.id, stageAgentDeps);

  for (const agent of stage.agents ?? []) {
    const agentDeps = new Set<string>();
    stageAgentDeps.set(agent.id, agentDeps);

    const inputs = agent.inputs ?? {};
    let explicitPreviousStageRef = false;

    for (const [key, ref] of Object.entries(inputs)) {
      if (ref === true && contextKeyDependencies[key]) {
        for (const depId of contextKeyDependencies[key]) {
          addDependency(stage.id, depId);
        }
      }
      if (key === 'previousStageResults' && ref && typeof ref === 'object' && 'from' in ref) {
        explicitPreviousStageRef = true;
      }
      if (!ref || typeof ref !== 'object' || !('from' in ref)) continue;
      const from = ref.from;
      if (from === 'stage') {
        addDependency(stage.id, ref.stageId);
      } else if (from === 'composite') {
        for (const depId of ref.stageIds ?? []) {
          addDependency(stage.id, depId);
        }
      } else if (from !== 'input') {
        agentDeps.add(from);
      }
    }

    if (!explicitPreviousStageRef && agent.inputFiles?.previousStageResults) {
      const index = stageIndex.get(stage.id) ?? 0;
      if (index > 0) {
        const prevStageId = stageIds[index - 1];
        stageDeps.add(prevStageId);
      }
    }
  }

  const overrides = stageDependencyOverrides[stage.id];
  if (overrides) {
    for (const depId of overrides) {
      addDependency(stage.id, depId);
    }
  }
}

const mainStageIds = stageIds.filter(id => id !== backgroundStageId);
const mainStageIndex = new Map<string, number>(
  mainStageIds.map((id, index) => [id, index])
);

const computeParallelGroups = (): string[][] => {
  const groups: string[][] = [];
  let i = 0;
  while (i < mainStageIds.length) {
    const startIndex = i;
    let endIndex = i;
    for (let j = i + 1; j < mainStageIds.length; j += 1) {
      const candidateId = mainStageIds[j];
      const deps = dependencies.get(candidateId) ?? new Set<string>();
      const hasInternalDependency = Array.from(deps).some(dep => {
        const depIndex = mainStageIndex.get(dep);
        return depIndex !== undefined && depIndex >= startIndex;
      });
      if (hasInternalDependency) break;
      endIndex = j;
    }
    if (endIndex > startIndex) {
      groups.push(mainStageIds.slice(startIndex, endIndex + 1));
    }
    i = endIndex + 1;
  }
  return groups;
};

const parallelCandidates = computeParallelGroups();

const formatList = (items: string[]): string => items.join(', ');

console.log('\nPipeline Parallelism Analysis');
console.log('==============================');
console.log(`Stages: ${stageIds.length}`);
console.log(`Parallel stage groups in config: ${config.parallelStageGroups?.length ?? 0}`);
if (backgroundStageId) {
  console.log(`Background stage handled separately: ${backgroundStageId}`);
}

console.log('\nStage Dependencies');
console.log('------------------');
for (const stage of config.stages) {
  const deps = Array.from(dependencies.get(stage.id) ?? []);
  const ordered = deps.sort((a, b) => (stageIndex.get(a) ?? 0) - (stageIndex.get(b) ?? 0));
  console.log(`${stage.id}: ${ordered.length > 0 ? formatList(ordered) : 'none'}`);
}

if (missingDependencies.size > 0) {
  console.log('\nMissing Dependencies (stage not found)');
  console.log('-------------------------------------');
  for (const [stageId, deps] of missingDependencies.entries()) {
    console.log(`${stageId}: ${formatList(Array.from(deps))}`);
  }
}

if (futureDependencies.size > 0) {
  console.log('\nFuture Dependencies (dependency after stage)');
  console.log('-------------------------------------------');
  for (const [stageId, deps] of futureDependencies.entries()) {
    console.log(`${stageId}: ${formatList(Array.from(deps))}`);
  }
}

console.log('\nCandidate Parallel Stage Groups (contiguous)');
console.log('--------------------------------------------');
if (parallelCandidates.length === 0) {
  console.log('No contiguous parallel groups found.');
} else {
  for (const group of parallelCandidates) {
    console.log(`- [${group.join(', ')}]`);
  }
}

console.log('\nExisting Parallel Stage Groups (config)');
console.log('---------------------------------------');
if (!config.parallelStageGroups || config.parallelStageGroups.length === 0) {
  console.log('None configured.');
} else {
  for (const group of config.parallelStageGroups) {
    console.log(`- [${group.join(', ')}]`);
  }
}

console.log('\nAgent-Level Dependencies (same stage)');
console.log('------------------------------------');
let hasAgentDeps = false;
for (const [stageId, agentsMap] of agentDependencies.entries()) {
  for (const [agentId, deps] of agentsMap.entries()) {
    if (deps.size === 0) continue;
    hasAgentDeps = true;
    console.log(`${stageId}.${agentId}: ${formatList(Array.from(deps))}`);
  }
}
if (!hasAgentDeps) {
  console.log('No intra-stage agent dependencies found in config.');
}

console.log('\nDone.');
