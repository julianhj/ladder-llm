#!/usr/bin/env node
/**
 * OpenAI Connection Test Script
 * 
 * Tests the connection to OpenAI API
 * Usage: npm run test:connection or ts-node scripts/test-connection.ts
 */

import { testOpenAIConnection, validateOpenAIConfig } from '../src/utils/OpenAIConnectionTest';
import { Logger, LogLevel } from '../src/utils/Logger';

async function main() {
  // Set log level to INFO for clearer output
  Logger.setLogLevel(LogLevel.INFO);
  
  console.log('🔍 Testing OpenAI Connection...\n');
  
  // First validate configuration
  console.log('1. Validating configuration...');
  const configResult = await validateOpenAIConfig();
  
  if (configResult.success) {
    console.log('✅ Configuration is valid\n');
  } else {
    console.log('❌ Configuration validation failed:');
    console.log(`   ${configResult.message}\n`);
    if (configResult.details) {
      console.log('Details:');
      console.log(`   - Config loaded: ${configResult.details.configLoaded}`);
      console.log(`   - API key present: ${configResult.details.apiKeyPresent}`);
      console.log(`   - Base URL: ${configResult.details.baseURL}`);
      if (configResult.details.error) {
        console.log(`   - Error: ${configResult.details.error}`);
      }
    }
    process.exit(1);
  }
  
  // Then test actual connection
  console.log('2. Testing API connection...');
  const connectionResult = await testOpenAIConnection();
  
  if (connectionResult.success) {
    console.log(`✅ ${connectionResult.message}`);
    if (connectionResult.details) {
      console.log('\nConnection Details:');
      console.log(`   - Base URL: ${connectionResult.details.baseURL}`);
      console.log(`   - Model: ${connectionResult.details.model || 'N/A'}`);
      if (connectionResult.details.responseTime) {
        console.log(`   - Response time: ${connectionResult.details.responseTime}ms`);
      }
    }
    console.log('\n🎉 OpenAI connection is working correctly!');
    process.exit(0);
  } else {
    console.log(`❌ ${connectionResult.message}`);
    if (connectionResult.details) {
      console.log('\nDetails:');
      console.log(`   - Config loaded: ${connectionResult.details.configLoaded}`);
      console.log(`   - API key present: ${connectionResult.details.apiKeyPresent}`);
      console.log(`   - Base URL: ${connectionResult.details.baseURL}`);
      if (connectionResult.details.error) {
        console.log(`   - Error: ${connectionResult.details.error}`);
      }
    }
    console.log('\n💡 Troubleshooting tips:');
    console.log('   - Check that your API key is correct');
    console.log('   - Verify your network connection');
    console.log('   - Ensure the baseURL is correct (if using a custom endpoint)');
    console.log('   - Check OpenAI API status page');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

