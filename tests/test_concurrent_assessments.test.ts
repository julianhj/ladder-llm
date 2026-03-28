/**
 * Tests that multiple assessment runs can execute concurrently without
 * cross-run contamination (tracker, logger context, runId).
 */

import { PipelineRunner } from '../src/recruitment/pipeline/PipelineRunner';
import { AgentBuilder, CandidateProfile, initializeOpenAI } from '../src/recruitment/agents/AgentBuilder';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { getSampleCandidate, createTestRequestContext } from './testUtils';
import { Logger } from '../src/recruitment/utils/Logger';

jest.mock('../src/recruitment/agents/AgentBuilder');
jest.mock('../src/recruitment/loaders/ConfigLoader');

describe('Concurrent assessments', () => {
  let sampleCandidateProfile: CandidateProfile;

  const mockAgentConfigs = [
    {
      id: 'stage_3_interviews',
      name: 'Stage 1 - Interviews',
      agents: [
        {
          id: 'technical_interviewer',
          name: 'Technical Interviewer',
          promptBase: 'stage_3_interviews/technical_interviewer',
          version: '3.0.0',
          outputSchema: 'assessment' as const,
          modelParams: { temperature: 0.7 },
        },
      ],
    },
    {
      id: 'stage_14_consensus_decision',
      name: 'Stage 8 - Consensus Decision',
      agents: [
        {
          id: 'consensus_decision_maker',
          name: 'Consensus Decision Maker',
          promptBase: 'stage_14_consensus_decision/agent_alignment_overview',
          version: '1.0.0',
          outputSchema: 'assessment' as const,
          modelParams: { temperature: 0.6 },
        },
      ],
    },
  ];

  beforeAll(async () => {
    sampleCandidateProfile = await getSampleCandidate();
    const openaiConfig = await ConfigLoader.loadOpenAIConfig();
    await initializeOpenAI(openaiConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should isolate tracker and runId when two pipelines run in parallel', async () => {
    const mockAgent = {
      config: { name: 'Mock Agent' },
      init: jest.fn().mockResolvedValue(undefined),
      estimateTokens: jest.fn().mockReturnValue({
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      }),
      invokeAgent: jest.fn().mockResolvedValue({ result: { decision: 'hire', score: 85 } }),
    };

    (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
      (config: any) => ({ ...mockAgent, config }) as any
    );

    const ctxA = createTestRequestContext({ correlationToken: 'run-a-uuid' });
    const ctxB = createTestRequestContext({ correlationToken: 'run-b-uuid' });

    const runnerA = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
    const runnerB = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
    await runnerA.initAllAgents();
    await runnerB.initAllAgents();

    const [resultsA, resultsB] = await Promise.all([
      runnerA.runPipeline(ctxA),
      runnerB.runPipeline(ctxB),
    ]);

    expect(resultsA).toHaveLength(3);
    expect(resultsB).toHaveLength(3);

    const logDataA = ctxA.tracker.getLogData();
    const logDataB = ctxB.tracker.getLogData();

    expect(logDataA.runId).toBe(ctxA.runId);
    expect(logDataB.runId).toBe(ctxB.runId);
    expect(ctxA.runId).not.toBe(ctxB.runId);

    expect(logDataA.stages?.length).toBe(2);
    expect(logDataB.stages?.length).toBe(2);
  });

  it('should keep logger context per run when using runWithRequestContext', async () => {
    Logger.clearLogs();

    await Promise.all([
      Logger.runWithRequestContext(
        { correlationToken: 'run-alpha', sessionToken: null },
        async () => {
          Logger.info('Test', 'Message from run alpha');
          await Promise.resolve();
        }
      ),
      Logger.runWithRequestContext(
        { correlationToken: 'run-beta', sessionToken: null },
        async () => {
          Logger.info('Test', 'Message from run beta');
          await Promise.resolve();
        }
      ),
    ]);

    const logs = Logger.getLogs();
    const alphaLogs = logs.filter((l) => (l.data as any)?.correlationToken === 'run-alpha');
    const betaLogs = logs.filter((l) => (l.data as any)?.correlationToken === 'run-beta');
    expect(alphaLogs.length).toBeGreaterThan(0);
    expect(betaLogs.length).toBeGreaterThan(0);
    alphaLogs.forEach((l) => expect((l.data as any)?.correlationToken).toBe('run-alpha'));
    betaLogs.forEach((l) => expect((l.data as any)?.correlationToken).toBe('run-beta'));
  });
});
