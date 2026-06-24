/**
 * Test replacement for ../config/stellarNetwork, wired in via Jest's
 * `moduleNameMapper`. Avoids the `import.meta.env` access that the Jest runner
 * (running modules as CommonJS) cannot evaluate.
 */
export function getStellarNetworkName(): string {
  return process.env.VITE_STELLAR_NETWORK ?? 'TESTNET';
}
