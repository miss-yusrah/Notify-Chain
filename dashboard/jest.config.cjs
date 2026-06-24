module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@creit\\.tech/stellar-wallets-kit/modules/utils$':
      '<rootDir>/src/test/stellarWalletsKitModulesMock.ts',
    '^@creit\\.tech/stellar-wallets-kit$':
      '<rootDir>/src/test/stellarWalletsKitMock.ts',
    '^.*/config/stellarNetwork$': '<rootDir>/src/test/stellarNetworkMock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          jsx: 'react-jsx',
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
};
