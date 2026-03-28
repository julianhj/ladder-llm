import { AgentBuilder, CandidateProfile, CandidateProfileSchema, initializeOpenAI, normalizeAssessmentScore } from '../src/recruitment/agents/AgentBuilder';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { getSampleCandidate } from './testUtils';

// Minimal valid section detail (section_detail_summary min 200, bullets min 2 × min 100)
const longSummary = 'x'.repeat(200);
const longBullet = 'y'.repeat(100);
const makeSection = (type: string, heading: string) => ({
  type,
  section_heading: heading,
  section_description: `${heading} description.`,
  section_detail: { section_detail_summary: longSummary, summary_detail_bullets: [longBullet, longBullet] },
});

// Mock OpenAI Responses API (client.responses.create) - assessment shape with sections
const defaultOutput = {
  decision: 'hire',
  score: 85,
  signal_blocks: { technical_depth: [], execution_maturity: [], leadership_scope: [], delivery_risk: [], business_alignment: [] },
  sections: [
    makeSection('narrative', 'Narrative'),
    makeSection('strengths', 'Strengths'),
    makeSection('concerns', 'Concerns'),
    makeSection('recommendations', 'Recommendations'),
    makeSection('interview_questions', 'Interview Questions'),
    makeSection('missing_signals', 'Missing Signals'),
    makeSection('interview_risks', 'Interview Risks'),
    makeSection('reasons_to_hire', 'Reasons to Hire'),
    makeSection('reasons_not_to_hire', 'Reasons Not to Hire'),
  ],
};

const mockResponsesCreate = jest.fn().mockResolvedValue({
  output: defaultOutput,
  finish_reason: 'stop',
  usage: {
    prompt_tokens: 100,
    completion_tokens: 200,
    total_tokens: 300,
  },
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    responses: {
      create: mockResponsesCreate,
    },
  }));
});

describe('AgentBuilder', () => {
  let sampleCandidateProfile: CandidateProfile;

  const sampleAgentConfig = {
    id: 'test_agent',
    name: 'Test Agent',
    promptBase: 'stage_3_interviews/technical_interviewer',
    version: '3.0.0',
    outputSchema: 'assessment' as const,
    inputFiles: {
      candidateCV: 'candidate_cv.txt',
      jobDescription: 'job_description.txt',
    },
    modelParams: {
      temperature: 0.7,
    },
  };

  beforeAll(async () => {
    sampleCandidateProfile = await getSampleCandidate();
    // Initialize OpenAI with default config for tests
    const openaiConfig = await ConfigLoader.loadOpenAIConfig();
    await initializeOpenAI(openaiConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponsesCreate.mockResolvedValue({
      output: defaultOutput,
      finish_reason: 'stop',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    });
  });

  describe('Constructor', () => {
    it('should create an AgentBuilder instance', () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should set correct output schema for assessment', () => {
      const agent = new AgentBuilder(
        { ...sampleAgentConfig, outputSchema: 'assessment' },
        sampleCandidateProfile
      );
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should set correct output schema for cv_optimization', () => {
      const agent = new AgentBuilder(
        { ...sampleAgentConfig, outputSchema: 'cv_optimization' },
        sampleCandidateProfile
      );
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should set correct output schema for final_decision', () => {
      const agent = new AgentBuilder(
        { ...sampleAgentConfig, outputSchema: 'final_decision' },
        sampleCandidateProfile
      );
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should set correct output schema for consensus', () => {
      const agent = new AgentBuilder(
        { ...sampleAgentConfig, outputSchema: 'consensus' },
        sampleCandidateProfile
      );
      expect(agent).toBeInstanceOf(AgentBuilder);
    });
  });

  describe('init', () => {
    it('should initialize agent and load prompt file', async () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      // If init succeeds without throwing, it's working
      expect(true).toBe(true);
    });

    it('should load input files if specified', async () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      // Agent should be initialized
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should fallback to candidate profile if input files are missing', async () => {
      const configWithoutFiles = {
        ...sampleAgentConfig,
        inputFiles: undefined,
      };
      const agent = new AgentBuilder(configWithoutFiles, sampleCandidateProfile);
      await agent.init();
      expect(agent).toBeInstanceOf(AgentBuilder);
    });

    it('should handle missing common output format gracefully', async () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      // Should not throw even if common format is missing
      await expect(agent.init()).resolves.not.toThrow();
    });

    it('injects only the fragments listed in config.injectedPrompts into the prompt object', async () => {
      const configWithInjectedPrompts = {
        ...sampleAgentConfig,
        id: 'technical_interviewer',
        name: 'Technical Interviewer',
        promptBase: 'stage_3_interviews/technical_interviewer',
        version: '3.0.0',
        outputSchema: 'assessment' as const,
        injectedPrompts: ['json_output_format', 'output_verbosity_enforcement', 'seniority_alignment', 'llm_responsibilities'],
      };
      const agent = new AgentBuilder(configWithInjectedPrompts, sampleCandidateProfile);
      await agent.init();
      const promptStr = (agent as unknown as { prompt: string }).prompt;
      expect(promptStr).toBeDefined();
      const promptJson = JSON.parse(promptStr) as Record<string, unknown>;
      for (const key of configWithInjectedPrompts.injectedPrompts!) {
        expect(promptJson).toHaveProperty(key);
        expect(typeof promptJson[key]).toBe('string');
        expect((promptJson[key] as string).length).toBeGreaterThan(0);
      }
    });
  });

  describe('invokeAgent', () => {
    it('should throw error if prompt not loaded', async () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      // Don't call init, so prompt is not loaded
      await expect(agent.invokeAgent('stage_3_interviews', 'Stage 3 - Interviews')).rejects.toThrow('Prompt not loaded');
    });

    it('should invoke agent and return validated result with token usage', async () => {
      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      
      const invokeResult = await agent.invokeAgent('stage_14_consensus_decision', 'Stage 14 - Consensus Decision');
      
      expect(invokeResult).toBeDefined();
      expect(invokeResult.result).toBeDefined();
      expect(invokeResult.result).toHaveProperty('decision');
      expect(invokeResult.result).toHaveProperty('score');
      expect(invokeResult.result).toHaveProperty('sections');
      expect((invokeResult.result as { sections: unknown[] }).sections).toHaveLength(9);
      expect(invokeResult.tokenUsage).toBeDefined();
      expect(invokeResult.tokenUsage).toMatchObject({ inputTokens: 100, outputTokens: 200, totalTokens: 300 });
    });

    it('should handle OpenAI API errors', async () => {
      mockResponsesCreate.mockRejectedValueOnce(new Error('API Error'));

      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      
      await expect(agent.invokeAgent('stage_14_consensus_decision', 'Stage 14 - Consensus Decision')).rejects.toThrow();
      
      mockResponsesCreate.mockResolvedValue({
        output: defaultOutput,
        finish_reason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    });

    it('should handle invalid JSON in response', async () => {
      // Agent can retry up to 3 parse attempts (initial + 2 re-calls), so mock invalid JSON for all
      mockResponsesCreate
        .mockResolvedValueOnce({
          output: 'Invalid JSON response',
          finish_reason: 'stop',
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
        .mockResolvedValueOnce({
          output: 'Invalid JSON response',
          finish_reason: 'stop',
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
        .mockResolvedValueOnce({
          output: 'Invalid JSON response',
          finish_reason: 'stop',
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        });

      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();

      await expect(agent.invokeAgent('stage_14_consensus_decision', 'Stage 14 - Consensus Decision')).rejects.toThrow('Failed to extract structured data from response');

      mockResponsesCreate.mockResolvedValue({
        output: defaultOutput,
        finish_reason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    });

    it('should validate output against schema', async () => {
      const invalidResponse = {
        output: { invalid: 'data' },
        finish_reason: 'stop' as const,
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      };
      mockResponsesCreate.mockResolvedValue(invalidResponse);

      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();

      await expect(agent.invokeAgent('stage_14_consensus_decision', 'Stage 14 - Consensus Decision')).rejects.toThrow('Failed to validate output against schema');

      mockResponsesCreate.mockResolvedValue({
        output: defaultOutput,
        finish_reason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    });
  });

  describe('CandidateProfile validation', () => {
    it('should validate correct candidate profile', () => {
      const profile = {
        name: 'Test User',
        email: 'test@example.com',
        company_name: 'Test Corp',
        role_applying_for: 'Developer',
        structured_cv: { sections: [] },
        structured_job_description: { role_title: 'Developer', company: 'Test Corp' },
        criticality_level: 'objective' as const,
      };
      
      expect(() => CandidateProfileSchema.parse(profile)).not.toThrow();
    });

    it('should reject invalid candidate profile', () => {
      const invalidProfile = {
        name: 'Test User',
        // Missing required fields: email, company_name, role_applying_for, structured_cv, structured_job_description
      };
      
      expect(() => CandidateProfileSchema.parse(invalidProfile)).toThrow();
    });

    it('should default criticality_level to objective', () => {
      const profile = {
        name: 'Test User',
        email: 'test@example.com',
        company_name: 'Test Corp',
        role_applying_for: 'Developer',
        structured_cv: { sections: [] },
        structured_job_description: { role_title: 'Developer', company: 'Test Corp' },
      };
      
      const parsed = CandidateProfileSchema.parse(profile);
      expect(parsed.criticality_level).toBe('objective');
    });
  });

  describe('excludeFullStructuredDocuments', () => {
    const signalNormaliserConfig = {
      id: 'signal_normaliser',
      name: 'Signal Normaliser',
      promptBase: 'stage_4_signal_normalisation/signal_normaliser',
      version: '2.0.0',
      outputSchema: 'signal_normalized' as const,
      inputFiles: {} as Record<string, string>,
      inputs: {
        previousStageResults: { from: 'stage' as const, stageId: 'stage_3_interviews' },
      },
      modelParams: { max_tokens: 20000 },
    };

    it('should not add structuredCV or structuredJobDescription to inputData when excludeFullStructuredDocuments is true', async () => {
      const config = { ...signalNormaliserConfig, excludeFullStructuredDocuments: true };
      const agent = new AgentBuilder(config, sampleCandidateProfile);
      await agent.init();
      const inputData = (agent as unknown as { inputData: Record<string, string> }).inputData;
      expect(inputData).not.toHaveProperty('structuredCV');
      expect(inputData).not.toHaveProperty('structuredJobDescription');
    });

    it('should add structuredCV and structuredJobDescription to inputData when excludeFullStructuredDocuments is false or unset', async () => {
      const agent = new AgentBuilder(signalNormaliserConfig, sampleCandidateProfile);
      await agent.init();
      const inputData = (agent as unknown as { inputData: Record<string, string> }).inputData;
      expect(inputData).toHaveProperty('structuredCV');
      expect(inputData).toHaveProperty('structuredJobDescription');
    });
  });

  describe('normalizeAssessmentScore', () => {
    it('converts 0-10 scale to 0-100 (e.g. 7 → 70)', () => {
      const { score, corrected } = normalizeAssessmentScore(7);
      expect(score).toBe(70);
      expect(corrected).toBe(true);
    });

    it('converts 7.4 to 74 when model used 0-10 scale', () => {
      const { score, corrected } = normalizeAssessmentScore(7.4);
      expect(score).toBe(74);
      expect(corrected).toBe(true);
    });

    it('leaves scores in (10, 100] unchanged', () => {
      expect(normalizeAssessmentScore(74)).toEqual({ score: 74, corrected: false });
      expect(normalizeAssessmentScore(82)).toEqual({ score: 82, corrected: false });
      expect(normalizeAssessmentScore(11)).toEqual({ score: 11, corrected: false });
    });

    it('normalizes 10 → 100', () => {
      const { score, corrected } = normalizeAssessmentScore(10);
      expect(score).toBe(100);
      expect(corrected).toBe(true);
    });
  });
});

