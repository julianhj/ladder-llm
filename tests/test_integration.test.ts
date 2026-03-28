import { main, RecruitmentRequest } from '../src/recruitment/index';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { PipelineRunner } from '../src/recruitment/pipeline/PipelineRunner';
import { getSampleCandidate } from './testUtils';

// Mock all dependencies
jest.mock('../src/recruitment/loaders/ConfigLoader', () => ({
  ConfigLoader: {
    loadAgentsConfig: jest.fn(),
    loadOpenAIConfig: jest.fn().mockResolvedValue({
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
      defaultModel: { name: 'gpt-4o-mini', temperature: 0.7, maxTokens: 1000 },
    }),
  },
}));
jest.mock('../src/recruitment/pipeline/PipelineRunner');
jest.mock('../src/recruitment/agents/AgentBuilder');

describe('Integration Tests', () => {
  let sampleRequest: RecruitmentRequest;

  beforeAll(async () => {
    const sampleCandidate = await getSampleCandidate();
    const jdText = (sampleCandidate.structured_job_description as { summary?: string })?.summary ?? '';
    const cvText = typeof (sampleCandidate as { cv_content?: string }).cv_content === 'string'
      ? (sampleCandidate as { cv_content: string }).cv_content
      : JSON.stringify(sampleCandidate.structured_cv);
    sampleRequest = {
      file: cvText,
      candidate_name: sampleCandidate.name,
      candidate_email: sampleCandidate.email,
      company_name: sampleCandidate.company_name,
      role_applying_for: sampleCandidate.role_applying_for,
      job_description: jdText,
      criticality_level: sampleCandidate.criticality_level,
      verbosity_level: (sampleCandidate as { verbosity_level?: string }).verbosity_level || 'moderate',
      cv_optimization_level: (sampleCandidate as { cv_optimization_level?: string }).cv_optimization_level || 'moderate',
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('main function', () => {
    it('should execute full pipeline successfully', async () => {
      const mockConfig = {
        stages: [
          {
            name: 'Stage 1',
            agents: [
              {
                name: 'Test Agent',
                promptBase: 'test',
                version: '1.0.0',
                outputSchema: 'assessment' as const,
                modelParams: {},
              },
            ],
          },
        ],
      };

      const mockResults = [
        {
          stageName: 'Stage 1',
          results: [{ decision: 'hire', score: 85 }],
        },
      ];

      (ConfigLoader.loadAgentsConfig as jest.Mock).mockResolvedValue(mockConfig);
      
      const mockPipeline = {
        initAllAgents: jest.fn().mockResolvedValue(undefined),
        runPipeline: jest.fn().mockResolvedValue(mockResults),
        estimateTokenUsage: jest.fn().mockReturnValue({
          perAgent: [],
          perPipelineRun: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          perCandidate: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        }),
      };
      
      (PipelineRunner as jest.MockedClass<typeof PipelineRunner>).mockImplementation(
        () => mockPipeline as any
      );

      const runContext = { correlationToken: 'test-correlation-id', sessionToken: null as string | null };
      const results = await main(sampleRequest, runContext);

      expect(ConfigLoader.loadAgentsConfig).toHaveBeenCalled();
      expect(mockPipeline.initAllAgents).toHaveBeenCalled();
      expect(mockPipeline.runPipeline).toHaveBeenCalled();
      expect(results).toEqual(mockResults);
    });

    it('should validate candidate profile', async () => {
      const invalidRequest = {
        ...sampleRequest,
        candidate_name: '', // Invalid: empty name
      };

      await expect(main(invalidRequest, { correlationToken: 'test-correlation-id', sessionToken: null })).rejects.toThrow();
    });

    it('should handle config loading errors', async () => {
      (ConfigLoader.loadAgentsConfig as jest.Mock).mockRejectedValue(
        new Error('Config load failed')
      );

      await expect(main(sampleRequest, { correlationToken: 'test-correlation-id', sessionToken: null })).rejects.toThrow('Config load failed');
    });

    it('should handle pipeline execution errors', async () => {
      const mockConfig = {
        stages: [
          {
            name: 'Stage 1',
            agents: [
              {
                name: 'Test Agent',
                promptBase: 'test',
                version: '1.0.0',
                outputSchema: 'assessment' as const,
                modelParams: {},
              },
            ],
          },
        ],
      };

      (ConfigLoader.loadAgentsConfig as jest.Mock).mockResolvedValue(mockConfig);
      (ConfigLoader.loadOpenAIConfig as jest.Mock).mockResolvedValue({
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1',
        defaultModel: { name: 'gpt-4o-mini', temperature: 0.7, maxTokens: 1000 },
      });
      
      const mockPipeline = {
        initAllAgents: jest.fn().mockResolvedValue(undefined),
        runPipeline: jest.fn().mockRejectedValue(new Error('Pipeline failed')),
      };
      
      (PipelineRunner as jest.MockedClass<typeof PipelineRunner>).mockImplementation(
        () => mockPipeline as any
      );

      await expect(main(sampleRequest, { correlationToken: 'test-correlation-id', sessionToken: null })).rejects.toThrow('Pipeline failed');
    });

    it('should set log level from environment variable', async () => {
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'DEBUG';

      const mockConfig = {
        stages: [
          {
            name: 'Stage 1',
            agents: [
              {
                name: 'Test Agent',
                promptBase: 'test',
                version: '1.0.0',
                outputSchema: 'assessment' as const,
                modelParams: {},
              },
            ],
          },
        ],
      };

      (ConfigLoader.loadAgentsConfig as jest.Mock).mockResolvedValue(mockConfig);
      (ConfigLoader.loadOpenAIConfig as jest.Mock).mockResolvedValue({
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1',
        defaultModel: { name: 'gpt-4o-mini', temperature: 0.7, maxTokens: 1000 },
        pricing: {
          inputCostPerMillion: 0.15,
          outputCostPerMillion: 0.60,
          currency: 'USD',
          lastUpdated: '2024-11-06',
        },
      });
      
      const mockPipeline = {
        initAllAgents: jest.fn().mockResolvedValue(undefined),
        runPipeline: jest.fn().mockResolvedValue([]),
      };
      
      (PipelineRunner as jest.MockedClass<typeof PipelineRunner>).mockImplementation(
        () => mockPipeline as any
      );

      await main(sampleRequest, { correlationToken: 'test-correlation-id', sessionToken: null });

      // Restore original log level
      if (originalLogLevel) {
        process.env.LOG_LEVEL = originalLogLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });
  });
});

