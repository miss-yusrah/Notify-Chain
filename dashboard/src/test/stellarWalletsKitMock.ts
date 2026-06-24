/**
 * Test double for `@creit.tech/stellar-wallets-kit`, wired in via Jest's
 * `moduleNameMapper`. It records the calls the wallet service makes and lets a
 * test drive the kit's reactive events (STATE_UPDATED / WALLET_SELECTED /
 * DISCONNECT) and the success/failure of its async methods.
 */

type Handler = (event: { payload: Record<string, unknown> }) => void;

const listeners: Record<string, Handler[]> = {};

export const Networks = { PUBLIC: 'PUBLIC', TESTNET: 'TESTNET' } as const;

export const KitEventType = {
  STATE_UPDATED: 'STATE_UPDATED',
  WALLET_SELECTED: 'WALLET_SELECTED',
  DISCONNECT: 'DISCONNECT',
} as const;

export const ModuleType = {
  HW_WALLET: 'HW_WALLET',
  BRIDGE_WALLET: 'BRIDGE_WALLET',
} as const;

export const __control = {
  authModalImpl: async (): Promise<void> => {},
  fetchAddressImpl: async (): Promise<void> => {},
  disconnectImpl: async (): Promise<void> => {},
  setWalletCalls: [] as string[],
  initCalls: 0,
};

export const StellarWalletsKit = {
  init: (): void => {
    __control.initCalls += 1;
  },
  on: (eventType: string, handler: Handler): void => {
    (listeners[eventType] ||= []).push(handler);
  },
  authModal: (): Promise<void> => __control.authModalImpl(),
  setWallet: (id: string): void => {
    __control.setWalletCalls.push(id);
  },
  fetchAddress: (): Promise<void> => __control.fetchAddressImpl(),
  disconnect: (): Promise<void> => __control.disconnectImpl(),
};

/** Fire a kit event to every subscribed handler, mirroring the real kit. */
export function __emit(eventType: string, payload: Record<string, unknown>): void {
  (listeners[eventType] || []).forEach((handler) => handler({ payload }));
}
