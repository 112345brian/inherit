module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^obsidian$': '<rootDir>/src/__mocks__/obsidian.ts' },
  globals: { 'ts-jest': { tsconfig: { module: 'commonjs' } } },
};
