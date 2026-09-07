const base = require('./jest.config.cts');
module.exports = {
  ...base,
  displayName: 'backend-database-integration',
  setupFilesAfterEnv: [],
  testMatch: ['<rootDir>/apps/backend-e2e/src/database/**/*.integration.ts'],
  coverageDirectory: '<rootDir>/coverage/backend-database-integration',
  maxWorkers: 1,
};
