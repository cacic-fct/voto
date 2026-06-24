module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/**/*.module.ts',
    '!src/app/**/*.types.ts',
    '!src/app/**/dto/*.ts',
    '!src/app/auth/auth.constants.ts',
    '!src/app/auth/decorators/*.ts',
  ],
  coverageDirectory: '../../coverage/apps/backend',
  coverageReporters: ['text', 'json', 'json-summary', 'lcov'],
};
