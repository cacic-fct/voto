module.exports = {
  displayName: 'backend-e2e',
  rootDir: '../..',
  setupFilesAfterEnv: ['<rootDir>/apps/backend-e2e/src/support/test-setup.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/apps/backend-e2e/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@org/backend/app/(.*)$': '<rootDir>/apps/backend/src/app/$1',
    '^@org/backend/http-app$': '<rootDir>/apps/backend/src/app/bootstrap/backend-http-app.ts',
    '^@org/voting-contracts$': '<rootDir>/libs/shared/voting-contracts/src/index.ts',
    '^@cacic-fct/form-contracts$': '<rootDir>/libs/shared/form-contracts/src/index.ts',
  },
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/apps/backend-e2e/tsconfig.spec.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '<rootDir>/coverage/backend-e2e',
  coverageReporters: ['lcov', 'json', 'text', 'clover'],
  testTimeout: 30_000,
  collectCoverageFrom: [
    '<rootDir>/apps/backend/src/**/*.ts',
    '!<rootDir>/apps/backend/src/**/*.spec.ts',
    '!<rootDir>/apps/backend/src/**/*.test.ts',
    '!<rootDir>/apps/backend/src/**/*.stories.ts',
    '!<rootDir>/apps/backend/src/main.ts',
  ],
};
