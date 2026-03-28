/**
 * Integration tests for AgentBuilder with real OpenAI API calls
 * 
 * These tests require:
 * - OPENAI_API_KEY environment variable to be set
 * - Real API calls will be made (costs money)
 * - Run with: npm test -- test_agent_builder.integration.test.ts
 * 
 * To skip these tests: Set SKIP_INTEGRATION_TESTS=true
 */

import { AgentBuilder, CandidateProfile, initializeOpenAI } from '../src/recruitment/agents/AgentBuilder';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { getSampleCandidate } from './testUtils';

// DO NOT mock OpenAI - we want real API calls
// jest.mock('openai') is intentionally NOT called here

describe('AgentBuilder Integration Tests (Real OpenAI API)', () => {
  let sampleCandidateProfile: CandidateProfile;
  const skipIntegrationTests = process.env.SKIP_INTEGRATION_TESTS === 'true';

  beforeAll(async () => {
    // Check if we should skip integration tests
    if (skipIntegrationTests) {
      console.log('Skipping integration tests (SKIP_INTEGRATION_TESTS=true)');
      return;
    }

    // Verify API key is available
    const openaiConfig = await ConfigLoader.loadOpenAIConfig();
    if (!openaiConfig.apiKey || openaiConfig.apiKey === 'test-key') {
      throw new Error(
        'OPENAI_API_KEY not set or invalid. ' +
        'Set OPENAI_API_KEY environment variable or add apiKey to openai.json config file. ' +
        'To skip these tests, set SKIP_INTEGRATION_TESTS=true'
      );
    }

    sampleCandidateProfile = await getSampleCandidate();
    await initializeOpenAI(openaiConfig);
  });

  const sampleAgentConfig = {
    id: 'technical_interviewer',
    name: 'Technical Interviewer (Integration Test)',
    promptBase: 'stage_3_interviews/technical_interviewer',
    version: '3.0.0',
    outputSchema: 'assessment' as const,
    inputFiles: {
      candidateCV: 'candidate_cv.txt',
      jobDescription: 'job_description.txt',
    },
    modelParams: {
      temperature: 0.7,
      // max_tokens not specified - will use model's maximum (16384 for gpt-4o)
    },
  };

  describe('Real OpenAI API Calls', () => {
    it('should initialize agent and make real API call', async () => {
      if (skipIntegrationTests) {
        return;
      }

      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      
      const invokeResult = await agent.invokeAgent('stage_14_consensus_decision', 'Stage 14 - Consensus Decision') as any;
      
      // Verify we got a real response (invokeAgent returns { result, tokenUsage? })
      expect(invokeResult).toBeDefined();
      expect(invokeResult.result).toBeDefined();
      const result = invokeResult.result;
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('narrative');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      
      // Verify decision is valid
      expect(['hire', 'maybe', 'reject']).toContain(result.decision);
      
      console.log('Real API Response:', JSON.stringify(result, null, 2));
    }, 60000); // 60 second timeout for real API calls

    it('should handle different output schemas', async () => {
      if (skipIntegrationTests) {
        return;
      }

      const evidenceIntegrationConfig = {
        ...sampleAgentConfig,
        name: 'Evidence Integration (Integration Test)',
        promptBase: 'stage_15_final_decision/evidence_integration',
        version: '1.0.0',
        outputSchema: 'evidence_validated' as const,
      };

      const agent = new AgentBuilder(evidenceIntegrationConfig, sampleCandidateProfile);
      await agent.init();
      
      const invokeResult = await agent.invokeAgent('stage_15_final_decision', 'Stage 15 - Final Decision') as any;
      const result = invokeResult.result;
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty('validated_scope_signals');
      expect(result).toHaveProperty('validated_execution_signals');
      expect(result).toHaveProperty('validated_leadership_signals');
      expect(result).toHaveProperty('validated_business_signals');
      expect(result).toHaveProperty('validated_risk_signals');
      // missing_signals is not on EvidenceValidatedSchema; optional elsewhere
      
      console.log('Evidence Integration Result:', JSON.stringify(result, null, 2));
    }, 60000);

    it('should estimate tokens correctly', async () => {
      if (skipIntegrationTests) {
        return;
      }

      const agent = new AgentBuilder(sampleAgentConfig, sampleCandidateProfile);
      await agent.init();
      
      const tokenEstimate = agent.estimateTokens();
      
      expect(tokenEstimate).toBeDefined();
      expect(tokenEstimate.inputTokens).toBeGreaterThan(0);
      expect(tokenEstimate.outputTokens).toBeGreaterThan(0);
      expect(tokenEstimate.totalTokens).toBe(tokenEstimate.inputTokens + tokenEstimate.outputTokens);
      
      console.log('Token Estimate:', tokenEstimate);
    }, 30000);

    it('should handle API errors gracefully', async () => {
      if (skipIntegrationTests) {
        return;
      }

      // Create an agent with invalid config to trigger API error
      const invalidConfig = {
        ...sampleAgentConfig,
        modelParams: {
          temperature: 0.7,
          max_tokens: -1, // Invalid value
        },
      };

      const agent = new AgentBuilder(invalidConfig, sampleCandidateProfile);
      await agent.init();
      
      // This might succeed or fail depending on OpenAI's validation
      // We just want to ensure it doesn't crash
      try {
        await agent.invokeAgent('stage_3_interviews', 'Stage 3 - Interviews');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        console.log('Expected API error:', (error as Error).message);
      }
    }, 60000);
  });
});

