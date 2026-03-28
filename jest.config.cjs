/** Jest config in CommonJS so it works when package.json has "type": "module". */
const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.integration.test.ts'],
  collectCoverageFrom: [
    'src/recruitment/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  moduleNameMapper: {
    '^.*/agentBuilderDir\\.js$': '<rootDir>/tests/__mocks__/agentBuilderDir.ts',
    '^.*/executionTimeTrackerDir\\.js$': '<rootDir>/tests/__mocks__/executionTimeTrackerDir.ts',
    '^.*/configLoaderDir\\.js$': '<rootDir>/tests/__mocks__/configLoaderDir.ts',
    '^.*/preprocessingAgentDir\\.js$': '<rootDir>/tests/__mocks__/preprocessingAgentDir.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
  ],
};
