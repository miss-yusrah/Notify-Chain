/**
 * Resolves the configured Stellar network name from the Vite environment.
 *
 * Isolated in its own module so the `import.meta.env` access — which only Vite
 * can evaluate — stays out of unit tests, where it is replaced via Jest's
 * `moduleNameMapper` (see jest.config.cjs).
 */
export function getStellarNetworkName(): string {
  return import.meta.env?.VITE_STELLAR_NETWORK ?? 'TESTNET';
}
