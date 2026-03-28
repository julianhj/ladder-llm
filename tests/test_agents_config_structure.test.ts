import { readFileSync } from 'fs';
import path from 'path';

describe('agents.json structure', () => {
  it('includes Stage 8, 10, 12, 13 before Stage 14 (pipeline order for parallel group and consensus)', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as { stages: Array<{ name: string }> };
    const names = config.stages.map((s) => s.name);
    const idx8 = names.indexOf('Stage 8 - Panel Weighting');
    const idx10 = names.indexOf('Stage 10 - Anomaly Detection');
    const idx12 = names.indexOf('Stage 12 - Recruiter Reality Validator');
    const idx13 = names.indexOf('Stage 13 - Seniority Signal Enforcement');
    const idx14 = names.indexOf('Stage 14 - Consensus Decision');
    expect(idx8).toBeGreaterThanOrEqual(0);
    expect(idx10).toBeGreaterThanOrEqual(0);
    expect(idx12).toBeGreaterThanOrEqual(0);
    expect(idx13).toBeGreaterThanOrEqual(0);
    expect(idx14).toBeGreaterThanOrEqual(0);
    expect(idx10).toBeGreaterThan(idx8);
    expect(idx12).toBeGreaterThan(idx10);
    expect(idx13).toBeGreaterThan(idx12);
    expect(idx14).toBeGreaterThan(idx13);
  });

  it('Stage 10 has Automated Anomaly Detector agent with anomaly_detection schema', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{ name: string; agents: Array<{ name: string; outputSchema: string }> }>;
    };
    const stage10 = config.stages.find((s) => s.name === 'Stage 10 - Anomaly Detection');
    expect(stage10).toBeDefined();
    expect(stage10!.agents).toHaveLength(1);
    expect(stage10!.agents[0].name).toBe('Automated Anomaly Detector');
    expect(stage10!.agents[0].outputSchema).toBe('anomaly_detection');
  });

  it('stage_0_career_trajectory has one agent and career_trajectory_profile output', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{ id: string; name: string; agents: Array<{ id: string; outputSchema: string; promptBase: string }> }>;
    };
    const stage0 = config.stages.find((s) => s.id === 'stage_0_career_trajectory');
    expect(stage0).toBeDefined();
    expect(stage0!.agents).toHaveLength(1);
    expect(stage0!.agents[0].id).toBe('career_trajectory_analysis');
    expect(stage0!.agents[0].outputSchema).toBe('career_trajectory_profile');
    expect(stage0!.agents[0].promptBase).toMatch(/^stage_0_career_trajectory\//);
  });

  it('does not include stage_1_background; consensus composite omits it (config 2.3.0+)', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      version?: string;
      stages: Array<{ id: string; agents: Array<{ inputs?: Record<string, unknown> }> }>;
    };
    expect(config.stages.some((s) => s.id === 'stage_1_background')).toBe(false);
    expect(config.version).toBe('2.3.0');
    const stage14 = config.stages.find((s) => s.id === 'stage_14_consensus_decision');
    const prev = stage14?.agents[0]?.inputs?.previousStageResults as
      | { from?: string; stageIds?: string[] }
      | undefined;
    expect(prev?.from).toBe('composite');
    expect(prev?.stageIds).toBeDefined();
    expect(prev!.stageIds!.includes('stage_1_background')).toBe(false);
  });

  it('stage_14_consensus_decision has single Consensus Decision Maker agent (no mergeOutputs)', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{
        id: string;
        name: string;
        mergeOutputs?: { type: string; strategy: string; schema: string };
        agents: Array<{ id: string; name: string; outputSchema: string; promptBase: string }>;
      }>;
    };
    const stage14Consensus = config.stages.find((s) => s.id === 'stage_14_consensus_decision');
    expect(stage14Consensus).toBeDefined();
    expect(stage14Consensus!.mergeOutputs).toBeUndefined();
    expect(stage14Consensus!.agents).toHaveLength(1);
    expect(stage14Consensus!.agents[0].id).toBe('consensus_decision_maker');
    expect(stage14Consensus!.agents[0].name).toBe('Consensus Decision Maker');
    expect(stage14Consensus!.agents[0].outputSchema).toBe('consensus');
    expect(stage14Consensus!.agents[0].promptBase).toBe('stage_14_consensus_decision/consensus_decision_maker');
  });

  it('Stage 15 (Final Decision) has combine mergeOutputs and 6 CV optimization agents', () => {
    const configPath = path.resolve(__dirname, '../configs/agents.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{
        id: string;
        name: string;
        parallel?: boolean;
        mergeOutputs?: { type: string; sourceAgents?: string[]; output?: Record<string, unknown> };
        agents: Array<{ id: string; name: string; outputSchema: string; promptBase: string; inputs?: Record<string, unknown> }>;
      }>;
    };
    const stage15 = config.stages.find((s) => s.id === 'stage_15_final_decision');
    expect(stage15).toBeDefined();
    expect(stage15!.parallel).toBe(true);
    expect(stage15!.mergeOutputs).toBeDefined();
    expect(stage15!.mergeOutputs?.type).toBe('combine');
    expect(Array.isArray((stage15!.mergeOutputs as { sourceAgents?: string[] }).sourceAgents)).toBe(true);
    expect((stage15!.mergeOutputs as { sourceAgents?: string[] }).sourceAgents).toHaveLength(6);
    expect(stage15!.agents).toHaveLength(6);
    const names = stage15!.agents.map((a) => a.name);
    expect(names).toContain('Evidence Integration');
    expect(names).toContain('Seniority & Recruiter Reality Enforcement');
    expect(names).toContain('Skill Representation Formatter');
    expect(names).toContain('Experience Representation Formatter');
    expect(names).toContain('Section-Level CV Rewriter');
    expect(names).toContain('Role Fit & ATS Enhancement');
    const expAgent = stage15!.agents.find((a) => a.id === 'experience_representation_formatter');
    expect(expAgent?.outputSchema).toBe('formatted_experience');
    expect(expAgent?.promptBase).toBe('stage_15_final_decision/experience_formatter');
    expect(stage15!.agents[0].promptBase).toBe('stage_15_final_decision/evidence_integration');
    expect(stage15!.agents[0].outputSchema).toBe('evidence_validated');
    expect(stage15!.agents[0].inputs).toBeDefined();
  });
});
