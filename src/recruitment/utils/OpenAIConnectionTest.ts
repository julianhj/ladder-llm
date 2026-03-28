/**
 * OpenAI Connection Test Utility
 * 
 * Tests the connection to OpenAI API and validates configuration
 */

import { ConfigLoader } from '../loaders/ConfigLoader.js';
import { initializeOpenAI, getOpenAIClient, getOpenAIConfig } from '../agents/AgentBuilder.js';
import { Logger } from './Logger.js';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: {
    configLoaded: boolean;
    apiKeyPresent: boolean;
    baseURL: string;
    model?: string;
    responseTime?: number;
    error?: string;
  };
}

/**
 * Tests the OpenAI connection by making a simple API call
 */
export async function testOpenAIConnection(): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  
  try {
    // Load configuration
    Logger.info('OpenAIConnectionTest', 'Loading OpenAI configuration...');
    const config = await ConfigLoader.loadOpenAIConfig();
    
    if (!config.apiKey) {
      return {
        success: false,
        message: 'OpenAI API key not found. Please set OPENAI_API_KEY environment variable or add apiKey to openai.json config file.',
        details: {
          configLoaded: true,
          apiKeyPresent: false,
          baseURL: config.baseURL || 'https://api.openai.com/v1',
        },
      };
    }
    
    // Initialize OpenAI client
    Logger.info('OpenAIConnectionTest', 'Initializing OpenAI client...');
    await initializeOpenAI(config);
    
    const client = getOpenAIClient();
    const finalConfig = getOpenAIConfig();
    const modelName = finalConfig.defaultModel?.name;
    if (!modelName?.trim()) {
      return {
        success: false,
        message:
          'OpenAI defaultModel.name is not set. Add defaultModel.name to configs/openai.json.',
        details: {
          configLoaded: true,
          apiKeyPresent: true,
          baseURL: finalConfig.baseURL || 'https://api.openai.com/v1',
        },
      };
    }

    Logger.info('OpenAIConnectionTest', 'Testing connection with a simple API call...', {
      baseURL: finalConfig.baseURL || 'https://api.openai.com/v1',
      model: modelName,
    });
    
    // Make a simple test API call using Responses API
    const testStartTime = Date.now();
    const response = await (client as any).responses.create({
      model: modelName,
      input: 'Say "Connection test successful" and nothing else.',
      instructions: 'You are a helpful assistant.',
      max_output_tokens: 10,
      temperature: 0,
    });
    
    const responseTime = Date.now() - testStartTime;
    const totalTime = Date.now() - startTime;
    
    const content = response.output || '';
    const success = content.toLowerCase().includes('successful') || content.length > 0;
    
    Logger.info('OpenAIConnectionTest', 'Connection test completed', {
      success,
      responseTime,
      totalTime,
      responseLength: content.length,
      tokensUsed: response.usage?.total_tokens,
    });
    
    return {
      success,
      message: success
        ? `Connection test successful! Response received in ${responseTime}ms.`
        : `Connection test completed but response was unexpected: ${content}`,
      details: {
        configLoaded: true,
        apiKeyPresent: true,
        baseURL: finalConfig.baseURL || 'https://api.openai.com/v1',
        model: modelName,
        responseTime,
      },
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    Logger.error('OpenAIConnectionTest', 'Connection test failed', error as Error, {
      totalTime,
    });
    
    // Try to get config details even if connection failed
    let configDetails: ConnectionTestResult['details'] = {
      configLoaded: false,
      apiKeyPresent: false,
      baseURL: 'unknown',
      error: errorMessage,
    };
    
    try {
      const config = await ConfigLoader.loadOpenAIConfig();
      configDetails = {
        configLoaded: true,
        apiKeyPresent: !!config.apiKey,
        baseURL: config.baseURL || 'https://api.openai.com/v1',
        error: errorMessage,
      };
    } catch (configError) {
      // Config loading also failed
    }
    
    return {
      success: false,
      message: `Connection test failed: ${errorMessage}`,
      details: configDetails,
    };
  }
}

/**
 * Validates OpenAI configuration without making an API call
 */
export async function validateOpenAIConfig(): Promise<ConnectionTestResult> {
  try {
    const config = await ConfigLoader.loadOpenAIConfig();
    
    const issues: string[] = [];
    
    if (!config.apiKey) {
      issues.push('API key is missing');
    }
    
    if (!config.baseURL) {
      issues.push('Base URL is missing');
    }
    
    if (!config.defaultModel?.name) {
      issues.push('Default model name is missing');
    }
    
    const success = issues.length === 0;
    
    return {
      success,
      message: success
        ? 'Configuration is valid'
        : `Configuration issues found: ${issues.join(', ')}`,
      details: {
        configLoaded: true,
        apiKeyPresent: !!config.apiKey,
        baseURL: config.baseURL || 'https://api.openai.com/v1',
        model: config.defaultModel?.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        configLoaded: false,
        apiKeyPresent: false,
        baseURL: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

