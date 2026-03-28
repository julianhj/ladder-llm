import OpenAI from 'openai';
import { Logger } from '../utils/Logger.js';
import { OpenAIConfig } from '../loaders/ConfigLoader.js';

let openaiClient: OpenAI | null = null;
let openaiConfig: OpenAIConfig | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize OpenAI client with configuration.
 * Safe for parallel execution: concurrent callers await the same init.
 * Intended to be called once at startup.
 */
export async function initializeOpenAI(config: OpenAIConfig): Promise<void> {
  if (openaiClient && openaiConfig) {
    return;
  }
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    openaiConfig = config;

    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error(
        'OpenAI API key is missing. Please set the OPENAI_API_KEY environment variable or configure it in configs/openai.json'
      );
    }

    const clientConfig: {
      apiKey?: string;
      baseURL?: string;
      timeout?: number;
      maxRetries?: number;
    } = {};

    if (config.apiKey) {
      clientConfig.apiKey = config.apiKey;
    }
    if (config.baseURL) {
      clientConfig.baseURL = config.baseURL;
    }
    clientConfig.timeout = config.timeout ?? 180000;
    clientConfig.maxRetries = config.maxRetries ?? 3;

    openaiClient = new OpenAI(clientConfig);

    Logger.debug('AgentBuilder', 'Initialized OpenAI client', {
      baseURL: clientConfig.baseURL || 'https://api.openai.com/v1',
      hasApiKey: !!clientConfig.apiKey,
      timeout: clientConfig.timeout,
      maxRetries: clientConfig.maxRetries,
    });
  })();

  await initPromise;
}

/**
 * Get the OpenAI client instance.
 */
export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Call initializeOpenAI() first.');
  }
  return openaiClient;
}

/**
 * Get the OpenAI configuration.
 */
export function getOpenAIConfig(): OpenAIConfig {
  if (!openaiConfig) {
    throw new Error('OpenAI config not loaded. Call initializeOpenAI() first.');
  }
  return openaiConfig;
}
