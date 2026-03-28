// Test setup file
// Mock environment variables
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-api-key';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'ERROR'; // Suppress logs during tests

