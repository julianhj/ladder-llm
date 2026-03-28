import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { readFile } from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

describe('ConfigLoader', () => {
  const mockAgentsConfig = {
    stages: [
      {
        name: 'Stage 1 - Interviews',
        agents: [
          {
            name: 'Technical Interviewer',
            promptBase: 'interviewers/technical_interviewer',
            version: '1.0.0',
            outputSchema: 'assessment',
            inputFiles: {
              candidateCV: 'candidate_cv.txt',
              jobDescription: 'job_description.txt',
            },
            modelParams: { temperature: 0.7 },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadAgentsConfig', () => {
    it('should load agents configuration from JSON file', async () => {
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(
        JSON.stringify(mockAgentsConfig)
      );

      const config = await ConfigLoader.loadAgentsConfig();

      expect(config).toBeDefined();
      expect(config.stages).toHaveLength(1);
      expect(config.stages[0].agents).toHaveLength(1);
      expect(config.stages[0].agents[0].name).toBe('Technical Interviewer');
    });

    it('should throw error if config file is missing', async () => {
      (readFile as jest.MockedFunction<typeof readFile>).mockRejectedValue(
        new Error('File not found')
      );

      await expect(ConfigLoader.loadAgentsConfig()).rejects.toThrow();
    });

    it('should throw error if config file is invalid JSON', async () => {
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(
        'Invalid JSON content'
      );

      await expect(ConfigLoader.loadAgentsConfig()).rejects.toThrow();
    });

    it('should load config with multiple stages', async () => {
      const multiStageConfig = {
        stages: [
          {
            name: 'Stage 1',
            agents: [{ name: 'Agent 1', promptBase: 'test', version: '1.0.0', modelParams: {} }],
          },
          {
            name: 'Stage 2',
            agents: [{ name: 'Agent 2', promptBase: 'test2', version: '1.0.0', modelParams: {} }],
          },
        ],
      };

      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(
        JSON.stringify(multiStageConfig)
      );

      const config = await ConfigLoader.loadAgentsConfig();

      expect(config.stages).toHaveLength(2);
      expect(config.stages[0].name).toBe('Stage 1');
      expect(config.stages[1].name).toBe('Stage 2');
    });

    it('should load config with agents that have different output schemas', async () => {
      const mixedSchemaConfig = {
        stages: [
          {
            name: 'Stage 1',
            agents: [
              {
                name: 'Assessment Agent',
                promptBase: 'test',
                version: '1.0.0',
                outputSchema: 'assessment',
                modelParams: {},
              },
              {
                name: 'CV Optimizer',
                promptBase: 'cv',
                version: '1.0.0',
                outputSchema: 'cv_optimization',
                modelParams: {},
              },
            ],
          },
        ],
      };

      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(
        JSON.stringify(mixedSchemaConfig)
      );

      const config = await ConfigLoader.loadAgentsConfig();

      expect(config.stages[0].agents).toHaveLength(2);
      expect(config.stages[0].agents[0].outputSchema).toBe('assessment');
      expect(config.stages[0].agents[1].outputSchema).toBe('cv_optimization');
    });

    it('merges agents.json defaultModel into agent modelParams', async () => {
      const cfg = {
        defaultModel: { name: 'gpt-default', temperature: 0.5, max_tokens: 9000 },
        stages: [
          {
            name: 'Stage 1',
            agents: [
              {
                id: 'a1',
                name: 'Agent 1',
                promptBase: 'test',
                version: '1.0.0',
                modelParams: { max_tokens: 12000 },
              },
              {
                id: 'a2',
                name: 'Agent 2',
                promptBase: 'test2',
                version: '1.0.0',
                modelParams: { model: 'gpt-override' },
              },
            ],
          },
        ],
      };
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(JSON.stringify(cfg));
      const config = await ConfigLoader.loadAgentsConfig();
      expect(config.stages[0].agents[0].modelParams).toEqual({
        model: 'gpt-default',
        temperature: 0.5,
        max_tokens: 12000,
      });
      expect(config.stages[0].agents[1].modelParams).toEqual({
        model: 'gpt-override',
        temperature: 0.5,
        max_tokens: 9000,
      });
    });
  });
});

