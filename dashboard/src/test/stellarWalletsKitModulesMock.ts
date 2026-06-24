/**
 * Test double for `@creit.tech/stellar-wallets-kit/modules/utils`, wired in via
 * Jest's `moduleNameMapper`. The wallet service only needs `defaultModules` to
 * exist and accept a filter.
 */
export function defaultModules(): unknown[] {
  return [];
}
