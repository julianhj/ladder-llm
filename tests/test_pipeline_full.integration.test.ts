/**
 * Full Pipeline Integration Test
 * 
 * Tests the complete recruitment pipeline with all stages and agents.
 * Makes real OpenAI API calls and logs detailed results from each agent.
 * 
 * These tests require:
 * - OPENAI_API_KEY environment variable to be set
 * - Real API calls will be made (costs money)
 * - Run with: npm run test:integration -- test_pipeline_full.integration.test.ts
 * 
 * To skip these tests: Set SKIP_INTEGRATION_TESTS=true
 */

import { PipelineRunner } from '../src/recruitment/pipeline/PipelineRunner';
import { ConfigLoader } from '../src/recruitment/loaders/ConfigLoader';
import { initializeOpenAI, CandidateProfile } from '../src/recruitment/agents/AgentBuilder';
import { getSampleCandidate, createTestRequestContext, failFastOnQuotaError } from './testUtils';
import { Logger, LogLevel } from '../src/recruitment/utils/Logger';

// DO NOT mock OpenAI - we want real API calls
// jest.mock('openai') is intentionally NOT called here

describe('Full Pipeline Integration Test (Real OpenAI API)', () => {
  let sampleCandidateProfile: CandidateProfile;
  const skipIntegrationTests = process.env.SKIP_INTEGRATION_TESTS === 'true';

  beforeAll(async () => {
    // Check if we should skip integration tests
    if (skipIntegrationTests) {
      console.log('Skipping integration tests (SKIP_INTEGRATION_TESTS=true)');
      return;
    }

    // Set log level to INFO for better visibility
    Logger.setLogLevel(LogLevel.INFO);

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

  /**
   * Formats agent result for logging
   */
  function formatAgentResult(agentName: string, result: unknown): string {
    const resultStr = JSON.stringify(result, null, 2);
    return `\n${'='.repeat(80)}\n` +
           `AGENT: ${agentName}\n` +
           `${'='.repeat(80)}\n` +
           `${resultStr}\n` +
           `${'='.repeat(80)}\n`;
  }


  (skipIntegrationTests ? it.skip : it)('should run full pipeline and log all agent results', async () => {

    console.log('\n\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    FULL PIPELINE INTEGRATION TEST                          ║');
    console.log('║                    Testing All 9 Agents Across 3 Stages                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Load agent configuration
    const agentsConfig = await ConfigLoader.loadAgentsConfig();
    
    console.log('📋 Pipeline Configuration:');
    console.log(`   - Total Stages: ${agentsConfig.stages.length}`);
    agentsConfig.stages.forEach((stage, index) => {
      console.log(`   - Stage ${index + 1}: ${stage.name} (${stage.agents.length} agents)`);
      stage.agents.forEach(agent => {
        console.log(`     • ${agent.name} (${agent.outputSchema})`);
      });
    });
    console.log('\n');

    console.log('👤 Candidate Profile:');
    console.log(`   - Name: ${sampleCandidateProfile.name}`);
    console.log(`   - Email: ${sampleCandidateProfile.email}`);
    console.log(`   - Company: ${sampleCandidateProfile.company_name}`);
    console.log(`   - Role: ${sampleCandidateProfile.role_applying_for}`);
    console.log(`   - Criticality: ${sampleCandidateProfile.criticality_level}`);
    const cvStr = JSON.stringify(sampleCandidateProfile.structured_cv);
    const jdStr = typeof (sampleCandidateProfile.structured_job_description as { summary?: string })?.summary === 'string'
      ? (sampleCandidateProfile.structured_job_description as { summary: string }).summary
      : '';
    console.log(`   - CV (structured) Length: ${cvStr.length} characters`);
    console.log(`   - Job Requirements Length: ${jdStr.length} characters`);
    console.log('\n');

    // Create pipeline
    const pipeline = new PipelineRunner(agentsConfig.stages, sampleCandidateProfile, agentsConfig.parallelStageGroups);
    
    console.log('🚀 Initializing all agents...\n');
    await pipeline.initAllAgents();
    
    // Get token estimates
    const tokenEstimate = pipeline.estimateTokenUsage(1);
    console.log('\n📊 Token Usage Estimate:');
    console.log(`   Per Pipeline Run:`);
    console.log(`     - Input: ${tokenEstimate.perPipelineRun.inputTokens.toLocaleString()} tokens`);
    console.log(`     - Output: ${tokenEstimate.perPipelineRun.outputTokens.toLocaleString()} tokens`);
    console.log(`     - Total: ${tokenEstimate.perPipelineRun.totalTokens.toLocaleString()} tokens`);
    console.log(`   Per Candidate:`);
    console.log(`     - Input: ${tokenEstimate.perCandidate.inputTokens.toLocaleString()} tokens`);
    console.log(`     - Output: ${tokenEstimate.perCandidate.outputTokens.toLocaleString()} tokens`);
    console.log(`     - Total: ${tokenEstimate.perCandidate.totalTokens.toLocaleString()} tokens`);
    console.log('\n');

    // Run pipeline
    console.log('⚙️  Running pipeline...\n');
    const startTime = Date.now();
    const stageResults = await pipeline.runPipeline(createTestRequestContext());
    failFastOnQuotaError(stageResults);
    const totalTime = Date.now() - startTime;

    // Build final response with all agent results
    const { getSampleCandidate } = await import('./testUtils');
    const candidate = await getSampleCandidate();

    const finalResponse = {
      candidate: {
        name: candidate.name,
        email: candidate.email,
        company_name: candidate.company_name,
        role_applying_for: candidate.role_applying_for,
        criticality_level: candidate.criticality_level,
        verbosity_level: (candidate as { verbosity_level?: string }).verbosity_level || 'moderate',
        cv_optimization_level: (candidate as { cv_optimization_level?: string }).cv_optimization_level || 'moderate',
      },
      stages: stageResults.map((stageResult, stageIndex) => {
        const stageConfig = agentsConfig.stages[stageIndex];
        return {
          stageName: stageResult.stageName,
          agents: stageResult.results.map((result, agentIndex) => ({
            agentName: stageConfig.agents[agentIndex].name,
            outputSchema: stageConfig.agents[agentIndex].outputSchema || 'assessment',
            result: result,
          })),
        };
      }),
      metadata: {
        executionTimeMs: totalTime,
        totalStages: stageResults.length,
        totalAgents: stageResults.reduce((sum, stage) => sum + stage.results.length, 0),
        tokenUsage: {
          perAgent: tokenEstimate.perAgent.map(agent => ({
            name: agent.agentName,
            inputTokens: agent.inputTokens,
            outputTokens: agent.outputTokens,
            totalTokens: agent.totalTokens,
          })),
          perPipelineRun: {
            inputTokens: tokenEstimate.perPipelineRun.inputTokens,
            outputTokens: tokenEstimate.perPipelineRun.outputTokens,
            totalTokens: tokenEstimate.perPipelineRun.totalTokens,
          },
          perCandidate: {
            inputTokens: tokenEstimate.perCandidate.inputTokens,
            outputTokens: tokenEstimate.perCandidate.outputTokens,
            totalTokens: tokenEstimate.perCandidate.totalTokens,
          },
        },
      },
    };

    // Write response to file for inspection
    const fs = await import('fs/promises');
    const path = await import('path');
    const outputDir = path.resolve(__dirname, '../outputs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFileName = `test-recruitment-response-${timestamp}.json`;
    const outputPath = path.join(outputDir, outputFileName);
    
    try {
      // Ensure output directory exists
      try {
        await fs.access(outputDir);
      } catch {
        await fs.mkdir(outputDir, { recursive: true });
      }
      
      await fs.writeFile(outputPath, JSON.stringify(finalResponse, null, 2), 'utf-8');
      console.log(`\n📄 Final response written to: ${outputPath}\n`);
    } catch (error) {
      console.error(`\n⚠️  Failed to write response to file: ${(error as Error).message}\n`);
    }

    console.log('\n\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         PIPELINE EXECUTION COMPLETE                        ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log(`\n⏱️  Total Execution Time: ${(totalTime / 1000).toFixed(2)} seconds\n`);

    // Log detailed results from each stage
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         DETAILED AGENT RESULTS                             ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Map stage results to agent names for better logging
    const agentNamesByStage: { [stageName: string]: string[] } = {};
    agentsConfig.stages.forEach(stage => {
      agentNamesByStage[stage.name] = stage.agents.map(a => a.name);
    });

    stageResults.forEach((stageResult, stageIndex) => {
      const agentNames = agentNamesByStage[stageResult.stageName] || [];
      
      console.log(`\n${'#'.repeat(80)}`);
      console.log(`STAGE ${stageIndex + 1}: ${stageResult.stageName}`);
      console.log(`${'#'.repeat(80)}\n`);

      stageResult.results.forEach((result, agentIndex) => {
        const agentName = agentNames[agentIndex] || `Agent ${agentIndex + 1}`;
        console.log(formatAgentResult(agentName, result));
      });
    });

    // Summary
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                            EXECUTION SUMMARY                               ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log(`\n✅ Total Stages Executed: ${stageResults.length}`);
    console.log(`✅ Total Agents Executed: ${stageResults.reduce((sum, stage) => sum + stage.results.length, 0)}`);
    console.log(`✅ Total Execution Time: ${(totalTime / 1000).toFixed(2)} seconds`);
    console.log(`✅ Average Time per Agent: ${(totalTime / stageResults.reduce((sum, stage) => sum + stage.results.length, 0) / 1000).toFixed(2)} seconds`);
    console.log('\n');

    // Verify we got results from all expected agents (stages with mergeOutputs add one Merged result)
    const expectedAgentCount = agentsConfig.stages.reduce((sum, stage) => sum + stage.agents.length, 0);
    const stagesWithMerge = agentsConfig.stages.filter((s: { mergeOutputs?: unknown }) => s.mergeOutputs != null).length;
    const actualAgentCount = stageResults.reduce((sum, stage) => sum + stage.results.length, 0);
    
    expect(stageResults).toBeDefined();
    expect(stageResults.length).toBe(agentsConfig.stages.length);
    expect(actualAgentCount).toBe(expectedAgentCount + stagesWithMerge);
    
    // Verify each stage has results (stages with mergeOutputs have agents.length + 1)
    stageResults.forEach((stageResult, index) => {
      const stageConfig = agentsConfig.stages[index];
      const expectedAgents = stageConfig.agents.length + (stageConfig.mergeOutputs ? 1 : 0);
      expect(stageResult.results.length).toBe(expectedAgents);
      expect(stageResult.results.every((r: { success?: boolean; agentName?: string; result?: unknown }) => r !== null && r !== undefined)).toBe(true);
    });

    // Verify Stage 3 (Interviews) results (assessment schema)
    const stage1 = stageResults.find((s: { stageName: string }) => s.stageName === 'Stage 3 - Interviews');
    if (stage1) {
      const stage1Results = stage1.results;
      expect(stage1Results.length).toBeGreaterThanOrEqual(1);
      stage1Results.forEach((agentResult: { result?: unknown; agentId?: string }) => {
        const assessment = (agentResult.result ?? agentResult) as Record<string, unknown>;
        expect(assessment).toHaveProperty('decision');
        expect(assessment).toHaveProperty('score');
        expect(assessment).toHaveProperty('narrative');
        expect(['hire', 'maybe', 'reject']).toContain(assessment.decision);
        expect(assessment.score).toBeGreaterThanOrEqual(0);
        expect(assessment.score).toBeLessThanOrEqual(100);
      });
    }

    // Verify Stage 13 (Consensus): single agent with overlay merged into consensus_decision_maker result
    const stage8Consensus = stageResults.find((s: { stageName: string }) => s.stageName === 'Stage 13 - Consensus Decision');
    if (stage8Consensus) {
      const consensusResult = stage8Consensus.results.find(
        (r: { agentId?: string; agentName?: string }) =>
          r.agentId === 'consensus_decision_maker' || r.agentName === 'Consensus Decision Maker'
      ) as { result?: Record<string, unknown> } | undefined;
      expect(consensusResult).toBeDefined();
      const consensus = consensusResult?.result ?? consensusResult;
      expect(consensus).toHaveProperty('decision');
      expect(consensus).toHaveProperty('score');
      expect(consensus).toHaveProperty('final_decision');
      expect(consensus).toHaveProperty('confidence');
      expect(consensus).toHaveProperty('reasoning');
      expect(consensus).toHaveProperty('next_steps');
      expect(['hire', 'declined', 'maybe']).toContain((consensus as Record<string, unknown>).final_decision);
      expect((consensus as Record<string, unknown>).confidence).toBeGreaterThanOrEqual(0);
      expect((consensus as Record<string, unknown>).confidence).toBeLessThanOrEqual(100);

    }

    // Verify Stage 9 results (5 parallel agents + Merged, or legacy single CV Optimizer)
    const stage3 = stageResults.find((s: { stageName: string }) => s.stageName === 'Stage 9 - Final Decision');
    const stage3Results = stage3 ? stage3.results : [];
    expect(stage3Results.length).toBeGreaterThanOrEqual(1);
    const mergedEntry = stage3Results.find((r: { agentName?: string }) => r.agentName === 'Merged') as { result?: Record<string, unknown> } | undefined;
    const cvOptimizerEntry = mergedEntry ?? (stage3Results[0] as { result?: Record<string, unknown> });
    const cvOptimizer = cvOptimizerEntry?.result ?? cvOptimizerEntry;
    expect(cvOptimizer).toHaveProperty('optimized_cv');
    expect(cvOptimizer).toHaveProperty('changes_made');
    expect(cvOptimizer).toHaveProperty('rationale');
    expect(cvOptimizer).toHaveProperty('missing_skills');

    console.log('✅ All pipeline validations passed!\n');
  }, 300000); // 5 minute timeout for full pipeline
});


