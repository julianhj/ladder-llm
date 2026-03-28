import { PipelineRunner } from '../src/recruitment/pipeline/PipelineRunner';
import { AgentBuilder, CandidateProfile, initializeOpenAI } from '../src/recruitment/agents/AgentBuilder';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { cvOptimizationHandler } from '../src/recruitment/agents/stage_15_final_decision/cvOptimizationHandler';
import { getSampleCandidate, createTestRequestContext } from './testUtils';

// Mock dependencies
jest.mock('../src/recruitment/agents/AgentBuilder');
jest.mock('../src/recruitment/loaders/ConfigLoader');

describe('PipelineRunner', () => {
  let sampleCandidateProfile: CandidateProfile;

  beforeAll(async () => {
    sampleCandidateProfile = await getSampleCandidate();
  });

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
        {
          id: 'soft_skills_interviewer',
          name: 'Soft Skills Interviewer',
          promptBase: 'stage_3_interviews/soft_skills_interviewer',
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
    // Initialize OpenAI with default config for tests
    const openaiConfig = await ConfigLoader.loadOpenAIConfig();
    await initializeOpenAI(openaiConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a PipelineRunner instance', () => {
      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      expect(runner).toBeInstanceOf(PipelineRunner);
    });

    it('should create AgentBuilder instances for each agent', () => {
      new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      
      // AgentBuilder should be called for each agent
      expect(AgentBuilder).toHaveBeenCalledTimes(3); // 2 in stage 1 + 1 in stage 2
    });
  });

  describe('initAllAgents', () => {
    it('should initialize all agents', async () => {
      const mockAgent = {
        config: { name: 'Mock Agent' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }),
      };
      
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      await runner.initAllAgents();

      expect(mockAgent.init).toHaveBeenCalledTimes(3);
    });

    it('should handle initialization errors', async () => {
      const mockAgent = {
        config: { name: 'Mock Agent' },
        init: jest.fn().mockRejectedValue(new Error('Init failed')),
        estimateTokens: jest.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }),
      };
      
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      
      await expect(runner.initAllAgents()).rejects.toThrow('Init failed');
    });
  });

  describe('runPipeline', () => {
    it('should run all stages sequentially', async () => {
      const mockResults = [
        { decision: 'hire', score: 85 },
        { decision: 'maybe', score: 70 },
      ];

      const mockAgent = {
        config: { name: 'Mock Agent' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }),
        invokeAgent: jest.fn()
          .mockResolvedValueOnce({ result: mockResults[0] })
          .mockResolvedValueOnce({ result: mockResults[1] })
          .mockResolvedValueOnce({ result: { decision: 'hire', score: 90 } }),
      };
      
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      await runner.initAllAgents();

      const results = await runner.runPipeline(createTestRequestContext());

      expect(results).toHaveLength(3);
      expect(results[0].stageName).toBe('Stage 1 - Interviews');
      expect(results[0].results).toHaveLength(2);
      expect(results[1].stageName).toBe('Stage 8 - Consensus Decision');
      expect(results[1].results).toHaveLength(1);
      expect(results[2].stageName).toBe('Stage 10 - Audit Logging');
    });

    it('should run agents in parallel within each stage', async () => {
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

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      await runner.initAllAgents();

      const startTime = Date.now();
      await runner.runPipeline(createTestRequestContext());
      const endTime = Date.now();

      // If agents run in parallel, total time should be less than sequential
      // (all invokeAgent calls should happen concurrently within a stage)
      expect(mockAgent.invokeAgent).toHaveBeenCalledTimes(3);
      
      // Stage 1 has 2 agents - they should be called (parallel execution)
      // The timing check is approximate since we're mocking
      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly with mocks
    });

    it('should handle stage execution errors (return partial results, do not throw)', async () => {
      const mockAgent = {
        config: { name: 'Mock Agent' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }),
        invokeAgent: jest.fn()
          .mockResolvedValueOnce({ result: { decision: 'hire', score: 85 } })
          .mockRejectedValueOnce(new Error('Agent failed'))
          .mockResolvedValueOnce({ result: { decision: 'hire', score: 90 } }),
      };

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      await runner.initAllAgents();

      const results = await runner.runPipeline(createTestRequestContext());
      expect(results).toHaveLength(3);
      expect(results[0].results).toHaveLength(2);
      const failedResult = results[0].results.find(r => !r.success);
      expect(failedResult).toBeDefined();
      expect(failedResult?.error?.message).toBe('Agent failed');
      expect(results[2].stageName).toBe('Stage 10 - Audit Logging');
    });

    it('should return results in correct order', async () => {
      const mockAgent = {
        config: { name: 'Mock Agent' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }),
        invokeAgent: jest.fn()
          .mockResolvedValueOnce({ result: { stage: 1, agent: 1 } })
          .mockResolvedValueOnce({ result: { stage: 1, agent: 2 } })
          .mockResolvedValueOnce({ result: { stage: 2, agent: 1 } }),
      };

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      await runner.initAllAgents();

      const results = await runner.runPipeline(createTestRequestContext());

      expect(results[0].stageName).toBe('Stage 1 - Interviews');
      expect(results[1].stageName).toBe('Stage 8 - Consensus Decision');
      expect(results[2].stageName).toBe('Stage 10 - Audit Logging');
    });

    it('throws when stage_15_final_decision lacks mergeOutputs combine', async () => {
      const configInvalidStage15 = [
        {
          id: 'stage_15_final_decision',
          name: 'Stage 15 - Final Decision',
          agents: [
            {
              id: 'cv_optimizer',
              name: 'CV Optimizer',
              promptBase: 'stage_15_final_decision/evidence_integration',
              version: '1.0.0',
              outputSchema: 'cv_optimization' as const,
              modelParams: { temperature: 0.6 },
            },
          ],
        },
      ];

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({
          config,
          init: jest.fn().mockResolvedValue(undefined),
          estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
          setInputData: jest.fn(),
          invokeAgent: jest.fn().mockResolvedValue({ result: {} }),
        }) as any
      );

      const runner = new PipelineRunner(configInvalidStage15, sampleCandidateProfile);
      await runner.initAllAgents();
      await expect(runner.runPipeline(createTestRequestContext())).rejects.toThrow(
        /stage_15_final_decision requires mergeOutputs\.type "combine"/
      );
    });

    it('does not skip the stage immediately after computed stage_9_signal_confidence_aggregation', async () => {
      const pipelineWithComputedStage = [
        {
          id: 'stage_3_interviews',
          name: 'Stage 3 - Interviews',
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
          id: 'stage_4_signal_normalisation',
          name: 'Stage 4 - Signal Normalisation',
          agents: [
            {
              id: 'signal_normaliser',
              name: 'Signal Normaliser',
              promptBase: 'stage_4_signal_normalisation/signal_normaliser',
              version: '1.0.0',
              outputSchema: 'signal_normalized' as const,
              inputFiles: { previousStageResults: '' },
              modelParams: { temperature: 0.6 },
            },
          ],
        },
        {
          id: 'stage_6_evidence_synthesiser',
          name: 'Stage 6 - Evidence Synthesiser',
          agents: [
            {
              id: 'evidence_synthesiser',
              name: 'Evidence Synthesiser',
              promptBase: 'stage_6_evidence_synthesiser/evidence_synthesiser',
              version: '1.0.0',
              outputSchema: 'evidence_synthesiser' as const,
              inputFiles: { previousStageResults: '' },
              modelParams: { temperature: 0.6 },
            },
          ],
        },
        {
          id: 'stage_8_panel_weighting',
          name: 'Stage 8 - Panel Weighting',
          agents: [
            {
              id: 'panel_weighting',
              name: 'Panel Weighting',
              promptBase: 'stage_8_panel_weighting/panel_weighting',
              version: '1.0.0',
              outputSchema: 'panel_weighting' as const,
              inputFiles: { previousStageResults: '' },
              modelParams: { temperature: 0.6 },
            },
          ],
        },
        {
          id: 'stage_9_signal_confidence_aggregation',
          name: 'Stage 9 - Signal Confidence Aggregation',
          agents: [],
        },
        {
          id: 'stage_14_consensus_decision',
          name: 'Stage 14 - Consensus Decision',
          agents: [
            {
              id: 'consensus_decision_maker',
              name: 'Consensus Decision Maker',
              promptBase: 'stage_14_consensus_decision/consensus_decision_maker',
              version: '1.0.0',
              outputSchema: 'consensus' as const,
              inputFiles: { previousStageResults: '' },
              modelParams: { temperature: 0.6 },
            },
          ],
        },
      ];

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation((config: any) => ({
        config,
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 100, totalTokens: 200 }),
        setInputData: jest.fn(),
        invokeAgent: jest.fn().mockResolvedValue({ result: { ok: true } }),
      }) as any);

      const runner = new PipelineRunner(pipelineWithComputedStage, sampleCandidateProfile);
      await runner.initAllAgents();
      const results = await runner.runPipeline(createTestRequestContext());

      const stage9 = results.find((stage) => stage.stageId === 'stage_9_signal_confidence_aggregation');
      const stage14 = results.find((stage) => stage.stageId === 'stage_14_consensus_decision');
      expect(stage9).toBeDefined();
      expect(stage14).toBeDefined();
      expect(results.indexOf(stage9!)).toBeLessThan(results.indexOf(stage14!));
    });

    it('should trim previousStageResults to field path when ref.field is set (e.g. result.signal_blocks)', async () => {
      const signalBlocksOnly = {
        technical_depth: ['Distributed systems experience'],
        execution_maturity: ['CI/CD ownership'],
        leadership_scope: ['Multi-team coaching'],
        delivery_risk: ['Limited metrics'],
        business_alignment: ['Stakeholder alignment'],
      };
      const narrativeText = 'Some long narrative that must not appear in trimmed payload.';
      const configWithFieldExtract = [
        {
          id: 'stage_3_interviews',
          name: 'Stage 3 - Interviews',
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
          id: 'stage_4_signal_normalisation',
          name: 'Stage 4 - Signal Normalisation',
          agents: [
            {
              id: 'signal_normaliser',
              name: 'Signal Normaliser',
              promptBase: 'stage_4_signal_normalisation/signal_normaliser',
              version: '2.0.0',
              outputSchema: 'signal_normalized' as const,
              inputFiles: {},
              inputs: {
                previousStageResults: {
                  from: 'stage',
                  stageId: 'stage_3_interviews',
                  field: 'result.signal_blocks',
                },
              },
              excludeFullStructuredDocuments: true,
              inputOnlyPreviousStageResults: true,
              modelParams: { temperature: 0.6 },
            },
          ],
        },
      ];

      const agentMocksByName: Record<string, any> = {};
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => {
          const mockAgent = {
            config,
            init: jest.fn().mockResolvedValue(undefined),
            estimateTokens: jest.fn().mockReturnValue({
              inputTokens: 100,
              outputTokens: 200,
              totalTokens: 300,
            }),
            setInputData: jest.fn(),
            invokeAgent: jest.fn(),
          };
          if (config.name === 'Technical Interviewer') {
            mockAgent.invokeAgent.mockResolvedValue({
              result: {
                signal_blocks: signalBlocksOnly,
                narrative: narrativeText,
                strengths: ['Strong technical fit'],
                concerns: ['Limited scope'],
              },
            });
          } else if (config.name === 'Signal Normaliser') {
            mockAgent.invokeAgent.mockResolvedValue({
              result: {
                aggregated_signals: { technical_scope: [], execution_authority: [], leadership_impact: [], business_alignment: [], delivery_risk: [] },
                confidence_scores: {},
                signal_gaps: [],
              },
            });
          }
          agentMocksByName[config.name] = mockAgent;
          return mockAgent as any;
        }
      );

      const runner = new PipelineRunner(configWithFieldExtract, sampleCandidateProfile);
      await runner.initAllAgents();
      await runner.runPipeline(createTestRequestContext());

      const signalNormaliser = agentMocksByName['Signal Normaliser'];
      expect(signalNormaliser).toBeDefined();
      const previousStageCalls = signalNormaliser.setInputData.mock.calls.filter(
        (call: unknown[]) => call[0] === 'previousStageResults'
      );
      expect(previousStageCalls.length).toBeGreaterThan(0);
      const payload = previousStageCalls[previousStageCalls.length - 1][1] as string;
      const parsed = JSON.parse(payload) as Array<{ agentId: string; agentName: string; success: boolean; result: unknown }>;

      expect(parsed).toHaveLength(1);
      expect(parsed[0].agentId).toBe('technical_interviewer');
      expect(parsed[0].agentName).toBe('Technical Interviewer');
      expect(parsed[0].result).toEqual(signalBlocksOnly);
      expect(payload).not.toContain(narrativeText);
      expect(payload).not.toContain('Strong technical fit');
    });

    it('should append Stage 10 - Audit Logging after Stage 14 with buildAuditLog result', async () => {
      const stage15MergeForAudit = {
        mergeOutputs: {
          type: 'combine' as const,
          sourceAgents: [
            'evidence_integration',
            'seniority_recruiter_reality_enforcement',
            'skill_representation_formatter',
            'experience_representation_formatter',
            'section_level_cv_rewriter',
            'role_fit_ats_enhancement',
          ],
          output: {
            optimized_cv_sections: { from: 'section_level_cv_rewriter', field: 'rewritten_sections' },
            changes_made: { from: 'evidence_integration', field: 'changes_made' },
            rationale: { from: 'evidence_integration', field: 'rationale' },
            ats_optimization: { from: 'evidence_integration', field: 'ats_optimization' },
            keyword_enhancements: { from: 'evidence_integration', field: 'keyword_enhancements' },
            missing_skills: { from: 'evidence_integration', field: 'missing_skills' },
          },
        },
        agents: [
          { id: 'evidence_integration', name: 'Evidence Integration', promptBase: 'stage_15_final_decision/evidence_integration', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          { id: 'seniority_recruiter_reality_enforcement', name: 'Seniority Enforcer', promptBase: 'stage_15_final_decision/seniority_reality_enforcer', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          { id: 'skill_representation_formatter', name: 'Skill Formatter', promptBase: 'stage_15_final_decision/skill_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          { id: 'experience_representation_formatter', name: 'Experience Formatter', promptBase: 'stage_15_final_decision/experience_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          { id: 'section_level_cv_rewriter', name: 'Section Rewriter', promptBase: 'stage_15_final_decision/section_rewriter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          { id: 'role_fit_ats_enhancement', name: 'Role Fit', promptBase: 'stage_15_final_decision/role_fit_ats', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
        ],
      };
      const configStages = [
        {
          id: 'stage_3_interviews',
          name: 'Stage 3 - Interviews',
          agents: [
            { id: 'technical_interviewer', name: 'Technical Interviewer', promptBase: 'stage_3_interviews/technical_interviewer', version: '3.0.0', outputSchema: 'assessment' as const, modelParams: { temperature: 0.7 } },
          ],
        },
        {
          id: 'stage_14_consensus_decision',
          name: 'Stage 14 - Consensus Decision',
          agents: [
            { id: 'consensus_decision_maker', name: 'Consensus Decision Maker', promptBase: 'stage_14_consensus_decision/agent_alignment_overview', version: '1.0.0', outputSchema: 'consensus' as const, inputFiles: { previousStageResults: '' }, modelParams: { temperature: 0.6 } },
          ],
        },
        {
          id: 'stage_15_final_decision',
          name: 'Stage 15 - Final Decision',
          ...stage15MergeForAudit,
        },
      ];
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => {
          const mockAgent = {
            config,
            init: jest.fn().mockResolvedValue(undefined),
            estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
            setInputData: jest.fn(),
            invokeAgent: jest.fn().mockImplementation(() => {
              if (config.name === 'Technical Interviewer') {
                return Promise.resolve({ result: { decision: 'hire', score: 85 } });
              }
              if (config.name === 'Consensus Decision Maker') {
                return Promise.resolve({ result: { final_decision: 'hire', confidence: 80 } });
              }
              if (config.id === 'evidence_integration') {
                return Promise.resolve({
                  result: {
                    changes_made: [],
                    rationale: [{ heading: 'Summary', summary: 'CV optimization completed.' }],
                    ats_optimization: { heading: 'ATS', summary: '' },
                    keyword_enhancements: [],
                    missing_skills: [],
                  },
                });
              }
              if (config.id === 'section_level_cv_rewriter') {
                return Promise.resolve({
                  result: {
                    rewritten_sections: [
                      {
                        section_title: 'Summary',
                        kind: 'summary',
                        content: { paragraphs: ['Summary text.'] },
                      },
                    ],
                  },
                });
              }
              return Promise.resolve({ result: {} });
            }),
          };
          return mockAgent as any;
        }
      );

      const runner = new PipelineRunner(configStages, sampleCandidateProfile);
      await runner.initAllAgents();
      const results = await runner.runPipeline(createTestRequestContext());

      const stage10 = results.find((s) => s.stageName === 'Stage 10 - Audit Logging');
      expect(stage10).toBeDefined();
      expect(stage10!.results).toHaveLength(1);
      expect(stage10!.results[0].success).toBe(true);
      expect(stage10!.results[0].agentName).toBe('Audit Logger');
      const auditLog = stage10!.results[0].result as {
        ui?: { audit_timestamp?: string };
        audit_timestamp?: string;
        final_decision?: string;
        consensus_score?: number;
      };
      const auditTimestamp = auditLog.ui?.audit_timestamp ?? auditLog.audit_timestamp;
      expect(auditTimestamp).toBeDefined();
      expect(typeof auditTimestamp).toBe('string');
      expect(auditLog.final_decision).toBe('hire');
      expect(auditLog.consensus_score).toBe(80);
    });

    it('should pass selected_missing_skills into Stage 15 merged post-process context', async () => {
      const profileWithSelected = {
        ...sampleCandidateProfile,
        selected_missing_skills: ['Kubernetes'],
      } as CandidateProfile;

      const stage15MergeOnly = [
        {
          id: 'stage_15_final_decision',
          name: 'Stage 15 - Final Decision',
          mergeOutputs: {
            type: 'combine' as const,
            sourceAgents: [
              'evidence_integration',
              'seniority_recruiter_reality_enforcement',
              'skill_representation_formatter',
              'experience_representation_formatter',
              'section_level_cv_rewriter',
              'role_fit_ats_enhancement',
            ],
            output: {
              optimized_cv_sections: { from: 'section_level_cv_rewriter', field: 'rewritten_sections' },
              changes_made: { from: 'evidence_integration', field: 'changes_made' },
              rationale: { from: 'evidence_integration', field: 'rationale' },
              ats_optimization: { from: 'evidence_integration', field: 'ats_optimization' },
              keyword_enhancements: { from: 'evidence_integration', field: 'keyword_enhancements' },
              missing_skills: { from: 'evidence_integration', field: 'missing_skills' },
            },
          },
          agents: [
            { id: 'evidence_integration', name: 'Evidence Integration', promptBase: 'stage_15_final_decision/evidence_integration', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'seniority_recruiter_reality_enforcement', name: 'Seniority Enforcer', promptBase: 'stage_15_final_decision/seniority_reality_enforcer', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'skill_representation_formatter', name: 'Skill Formatter', promptBase: 'stage_15_final_decision/skill_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'experience_representation_formatter', name: 'Experience Formatter', promptBase: 'stage_15_final_decision/experience_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'section_level_cv_rewriter', name: 'Section Rewriter', promptBase: 'stage_15_final_decision/section_rewriter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'role_fit_ats_enhancement', name: 'Role Fit', promptBase: 'stage_15_final_decision/role_fit_ats', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          ],
        },
      ];

      const mockAgent = {
        config: { id: 'mock', name: 'Mock Agent' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 100, totalTokens: 200 }),
        setInputData: jest.fn(),
        invokeAgent: jest.fn().mockImplementation((_stageId: string, _stageName: string) => {
          const id = (mockAgent.config as { id?: string }).id;
          if (id === 'evidence_integration') {
            return Promise.resolve({
              result: {
                changes_made: ['Updated wording'],
                rationale: [{ heading: 'Fit', summary: 'Improved fit.' }],
                ats_optimization: 'Improved structure',
                keyword_enhancements: ['TypeScript'],
                missing_skills: ['Kubernetes'],
              },
            });
          }
          if (id === 'section_level_cv_rewriter') {
            return Promise.resolve({
              result: {
                rewritten_sections: [
                  {
                    section_title: 'Skills',
                    kind: 'skills',
                    content: { groups: [{ heading: 'Additional Skills', items: [] }] },
                  },
                ],
              },
            });
          }
          return Promise.resolve({ result: {} });
        }),
      };

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation(
        (config: any) => ({ ...mockAgent, config }) as any
      );

      const postProcessSpy = jest.spyOn(cvOptimizationHandler, 'postProcessBeforeValidation');

      const runner = new PipelineRunner(stage15MergeOnly, profileWithSelected);
      await runner.initAllAgents();
      await runner.runPipeline(createTestRequestContext());

      expect(postProcessSpy).toHaveBeenCalled();
      const contextArg = postProcessSpy.mock.calls[postProcessSpy.mock.calls.length - 1][1] as {
        inputData?: { selected_missing_skills?: string; skill_representation_mode?: string };
      };
      expect(contextArg.inputData?.selected_missing_skills).toBe(JSON.stringify(['Kubernetes']));
      expect(['keywords', 'narrative']).toContain(contextArg.inputData?.skill_representation_mode ?? 'keywords');

      postProcessSpy.mockRestore();
    });

    it('Stage 15 merged optimized_cv keeps formatter skills and experience, ignoring section rewriter mutations', async () => {
      const stage15MergeOnly = [
        {
          id: 'stage_15_final_decision',
          name: 'Stage 15 - Final Decision',
          mergeOutputs: {
            type: 'combine' as const,
            sourceAgents: [
              'evidence_integration',
              'seniority_recruiter_reality_enforcement',
              'skill_representation_formatter',
              'experience_representation_formatter',
              'section_level_cv_rewriter',
              'role_fit_ats_enhancement',
            ],
            output: {
              optimized_cv_sections: { from: 'section_level_cv_rewriter', field: 'rewritten_sections' },
              changes_made: { from: 'evidence_integration', field: 'changes_made' },
              rationale: { from: 'evidence_integration', field: 'rationale' },
              ats_optimization: { from: 'evidence_integration', field: 'ats_optimization' },
              keyword_enhancements: { from: 'evidence_integration', field: 'keyword_enhancements' },
              missing_skills: { from: 'evidence_integration', field: 'missing_skills' },
            },
          },
          agents: [
            { id: 'evidence_integration', name: 'Evidence Integration', promptBase: 'stage_15_final_decision/evidence_integration', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'seniority_recruiter_reality_enforcement', name: 'Seniority Enforcer', promptBase: 'stage_15_final_decision/seniority_reality_enforcer', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'skill_representation_formatter', name: 'Skill Formatter', promptBase: 'stage_15_final_decision/skill_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'experience_representation_formatter', name: 'Experience Formatter', promptBase: 'stage_15_final_decision/experience_formatter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'section_level_cv_rewriter', name: 'Section Rewriter', promptBase: 'stage_15_final_decision/section_rewriter', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
            { id: 'role_fit_ats_enhancement', name: 'Role Fit', promptBase: 'stage_15_final_decision/role_fit_ats', version: '1.0.0', outputSchema: 'cv_optimization' as const, modelParams: { temperature: 0.4 } },
          ],
        },
      ];

      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation((config: { id?: string }) => ({
        config,
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 100, totalTokens: 200 }),
        setInputData: jest.fn(),
        invokeAgent: jest.fn().mockImplementation(() => {
          const id = config.id;
          if (id === 'evidence_integration') {
            return Promise.resolve({
              result: {
                changes_made: [],
                rationale: [{ heading: 'R', summary: 'S' }],
                ats_optimization: '',
                keyword_enhancements: [],
                missing_skills: [],
              },
            });
          }
          if (id === 'skill_representation_formatter') {
            return Promise.resolve({
              result: {
                missing_skills: [],
                skill_representation_mode: 'keywords',
                skills_formatted: { Platform: ['ECS', 'RDS'] },
              },
            });
          }
          if (id === 'experience_representation_formatter') {
            return Promise.resolve({
              result: {
                experience_formatted: [
                  {
                    company: 'Corp',
                    role: 'Lead',
                    period: '2019-2022',
                    responsibilities: ['Led team'],
                  },
                ],
              },
            });
          }
          if (id === 'section_level_cv_rewriter') {
            return Promise.resolve({
              result: {
                rewritten_sections: [
                  {
                    kind: 'skills',
                    section_title: 'Skills',
                    content: { groups: [{ heading: 'RewriterOnly', items: ['should-not-appear'] }] },
                  },
                  {
                    kind: 'experience',
                    section_title: 'Experience',
                    content: { items: [{ company: 'FakeCo', role: 'Intern' }] },
                  },
                ],
                changes_made: [],
                rationale: [{ heading: 'R', summary: 'S' }],
              },
            });
          }
          if (id === 'role_fit_ats_enhancement') {
            return Promise.resolve({
              result: {
                role_fit_summary: 'ok',
                ats_optimization: '',
                keyword_enhancements: [],
              },
            });
          }
          return Promise.resolve({ result: {} });
        }),
      }) as any);

      const runner = new PipelineRunner(stage15MergeOnly, sampleCandidateProfile);
      await runner.initAllAgents();
      const results = await runner.runPipeline(createTestRequestContext());
      const stage15 = results.find((s) => s.stageId === 'stage_15_final_decision');
      expect(stage15).toBeDefined();
      const mergedRes = stage15!.results.find((r) => r.agentId === 'merged');
      expect(mergedRes?.success).toBe(true);
      const opt = (mergedRes!.result as { optimized_cv?: { sections?: Array<Record<string, unknown>> } }).optimized_cv;
      expect(opt?.sections).toBeDefined();
      const skills = opt!.sections!.find((s) => s.kind === 'skills');
      const exp = opt!.sections!.find((s) => s.kind === 'experience');
      const skillGroups = (skills?.content as Record<string, unknown> | undefined)?.groups as
        | Array<{ heading?: string; items?: string[] }>
        | undefined;
      expect(skillGroups?.[0]?.heading).toBe('Platform');
      expect(skillGroups?.[0]?.items).toEqual(['ECS', 'RDS']);
      const items = (exp?.content as Record<string, unknown> | undefined)?.items as
        | Array<Record<string, unknown>>
        | undefined;
      expect(items?.[0]?.company).toBe('Corp');
      expect(items?.[0]?.responsibilities).toEqual(['Led team']);
    });

    it('uses typed target_seniority_class policy for Stage 15 context when style fields conflict', () => {
      const runner = new PipelineRunner(mockAgentConfigs, sampleCandidateProfile);
      const context = (runner as any).buildStage15PipelineContext([
        {
          stageId: 'stage_13_seniority_signal_enforcement',
          stageName: 'Stage 13 - Seniority Signal Enforcement',
          results: [
            {
              success: true,
              agentId: 'seniority_signal_enforcement',
              agentName: 'Seniority Signal Enforcement',
              result: {
                target_seniority_class: 'head',
                candidate_seniority_class: 'manager',
                target_seniority_level: 'Head of Operations',
                candidate_seniority_level: 'Operations Manager',
                skill_representation_mode: 'keywords',
                experience_format: 'bullets',
                seniority_gap: 'candidate below target',
                inflation_risk: 30,
                missing_signals: [],
                rewrite_constraints: [],
              },
            },
          ],
        },
      ]);
      expect(context.skill_representation_mode).toBe('narrative');
      expect(context.experience_format).toBe('hybrid');
      expect(context.target_role_seniority).toBe('Head of Operations');
    });

    it('should run Stage 9, 11, 12 in parallel when parallelStageGroups is set and push one result per stage', async () => {
      const stagesWithParallelGroup = [
        { id: 'stage_3_interviews', name: 'Stage 3 - Interviews', agents: [{ id: 'technical_interviewer', name: 'Technical', promptBase: 'stage_3/tech', version: '1.0.0', outputSchema: 'assessment' as const, modelParams: {} }] },
        { id: 'stage_4_signal_normalisation', name: 'Stage 4 - Signal', agents: [{ id: 'signal_normaliser', name: 'Signal Normaliser', promptBase: 'stage_4/signal', version: '1.0.0', outputSchema: 'signal_normalized' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_6_evidence_synthesiser', name: 'Stage 6 - Evidence', agents: [{ id: 'evidence_synthesiser', name: 'Evidence', promptBase: 'stage_6/ev', version: '1.0.0', outputSchema: 'evidence_synthesiser' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_8_panel_weighting', name: 'Stage 8 - Panel', agents: [{ id: 'panel_weighting', name: 'Panel', promptBase: 'stage_8/panel', version: '1.0.0', outputSchema: 'panel_weighting' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_9_anomaly_detection', name: 'Stage 9 - Anomaly', agents: [{ id: 'automated_anomaly_detector', name: 'Anomaly Detector', promptBase: 'stage_9/anomaly', version: '1.0.0', outputSchema: 'anomaly_detection' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_11_recruiter_reality_validator', name: 'Stage 11 - Recruiter Reality', agents: [{ id: 'recruiter_reality_validator', name: 'Recruiter Reality Validator', promptBase: 'stage_11/recruiter', version: '1.0.0', outputSchema: 'recruiter_reality_validation' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_12_seniority_signal_enforcement', name: 'Stage 12 - Seniority', agents: [{ id: 'seniority_signal_enforcement', name: 'Seniority Signal Enforcement', promptBase: 'stage_12/seniority', version: '1.0.0', outputSchema: 'seniority_signal_enforcement' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
        { id: 'stage_13_consensus_decision', name: 'Stage 13 - Consensus', agents: [{ id: 'consensus_decision_maker', name: 'Consensus', promptBase: 'stage_13/consensus', version: '1.0.0', outputSchema: 'consensus' as const, inputFiles: { previousStageResults: '' }, modelParams: {} }] },
      ];
      const parallelStageGroups: string[][] = [
        ['stage_9_anomaly_detection', 'stage_11_recruiter_reality_validator', 'stage_12_seniority_signal_enforcement'],
      ];
      const mockAgent = {
        config: { name: 'Mock' },
        init: jest.fn().mockResolvedValue(undefined),
        estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
        setInputData: jest.fn(),
        invokeAgent: jest.fn().mockResolvedValue({ result: { ok: true } }),
      };
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation((config: any) => ({ ...mockAgent, config }) as any);

      const runner = new PipelineRunner(stagesWithParallelGroup, sampleCandidateProfile, parallelStageGroups);
      await runner.initAllAgents();
      const results = await runner.runPipeline(createTestRequestContext());

      const stage9 = results.find((s) => s.stageId === 'stage_9_anomaly_detection');
      const stage11 = results.find((s) => s.stageId === 'stage_11_recruiter_reality_validator');
      const stage12 = results.find((s) => s.stageId === 'stage_12_seniority_signal_enforcement');
      const stage13 = results.find((s) => s.stageId === 'stage_13_consensus_decision');

      expect(stage9).toBeDefined();
      expect(stage11).toBeDefined();
      expect(stage12).toBeDefined();
      expect(stage13).toBeDefined();
      expect(stage9!.results).toHaveLength(1);
      expect(stage11!.results).toHaveLength(1);
      expect(stage12!.results).toHaveLength(1);
      expect(stage9!.results[0].agentId).toBe('automated_anomaly_detector');
      expect(stage11!.results[0].agentId).toBe('recruiter_reality_validator');
      expect(stage12!.results[0].agentId).toBe('seniority_signal_enforcement');
      const idx9 = results.indexOf(stage9!);
      const idx11 = results.indexOf(stage11!);
      const idx12 = results.indexOf(stage12!);
      const idx13 = results.indexOf(stage13!);
      expect(idx9).toBeLessThan(idx11);
      expect(idx11).toBeLessThan(idx12);
      expect(idx12).toBeLessThan(idx13);
    });

    it('injects input refs (structuredCV slices etc.) for parallel-pipeline stage agents before invoking them', async () => {
      const stage0Config = {
        id: 'stage_0_career_trajectory',
        name: 'Stage 0 - Career Trajectory',
        agents: [{
          id: 'career_trajectory_analysis',
          name: 'Career Trajectory Analysis',
          promptBase: 'stage_0_career_trajectory/career_trajectory_analysis',
          version: '1.4.0',
          outputSchema: 'career_trajectory_profile' as const,
          modelParams: {},
          inputs: {
            structuredCV_experience: { from: 'input' as const, field: 'structuredCV.experience' },
            structuredCV_summary_keywords: { from: 'input' as const, field: 'structuredCV.summary_keywords' },
            structuredCV_title: { from: 'input' as const, field: 'structuredCV.header.professional_title' },
          },
        }],
      };
      const mainStageConfig = {
        ...mockAgentConfigs[1],
        agents: [{ ...mockAgentConfigs[1].agents[0], inputs: { previousStageResults: { from: 'stage' as const, stageId: 'stage_0_career_trajectory' } } }],
      };
      const config = [stage0Config, mockAgentConfigs[0], mainStageConfig];
      const parallelStageGroups: string[][] = [['stage_0_career_trajectory']];

      const setInputDataCareer = jest.fn();
      (AgentBuilder as jest.MockedClass<typeof AgentBuilder>).mockImplementation((configArg: any) => {
        if (configArg.id === 'career_trajectory_analysis') {
          return {
            config: configArg,
            init: jest.fn().mockResolvedValue(undefined),
            estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
            invokeAgent: jest.fn().mockResolvedValue({ result: { trajectory: [] } }),
            setInputData: setInputDataCareer,
          } as any;
        }
        return {
          config: configArg,
          init: jest.fn().mockResolvedValue(undefined),
          estimateTokens: jest.fn().mockReturnValue({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
          invokeAgent: jest.fn().mockResolvedValue({ result: { decision: 'hire', score: 85 } }),
          setInputData: jest.fn(),
        } as any;
      });

      const runner = new PipelineRunner(config, sampleCandidateProfile, parallelStageGroups);
      await runner.initAllAgents();
      await runner.runPipeline(createTestRequestContext());

      expect(setInputDataCareer).toHaveBeenCalledWith('structuredCV_experience', expect.any(String));
      const experienceCall = setInputDataCareer.mock.calls.find((c: [string, string]) => c[0] === 'structuredCV_experience');
      expect(experienceCall).toBeDefined();
      expect(experienceCall![1].length).toBeGreaterThan(0);
      expect(setInputDataCareer).toHaveBeenCalledWith('structuredCV_title', expect.any(String));
    });
  });
});

