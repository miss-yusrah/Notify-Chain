import {
  StellarWalletsKit,
  Networks,
  KitEventType,
} from '@creit.tech/stellar-wallets-kit';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { ModuleType } from '@creit.tech/stellar-wallets-kit';
import {
  useWalletStore,
  getPersistedWalletId,
  setPersistedWalletId,
} from '../store/walletStore';

const NETWORK =
  (import.meta.env.VITE_STELLAR_NETWORK ?? 'TESTNET') === 'PUBLIC'
    ? Networks.PUBLIC
    : Networks.TESTNET;

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  StellarWalletsKit.init({
    modules: defaultModules({
      filterBy: (module) =>
        module.moduleType !== ModuleType.HW_WALLET &&
        module.moduleType !== ModuleType.BRIDGE_WALLET,
    }),
    network: NETWORK,
    selectedWalletId: getPersistedWalletId() ?? undefined,
  });

  // The kit's own reactive state — fires immediately with current state on
  // subscribe, then again on every change. This is the single source of
  // truth for "is a wallet connected right now."
  StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
    useWalletStore.getState().setAddress(event.payload.address ?? null);
  });

  StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
    setPersistedWalletId(event.payload.id ?? null);
  });

  StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
    setPersistedWalletId(null);
    useWalletStore.getState().setAddress(null);
  });
}

/**
 * Opens the built-in wallet selection modal and connects to whichever
 * wallet the user picks. The kit's STATE_UPDATED event (subscribed in
 * ensureInitialized) updates the store once connected.
 */
export async function connectWallet(): Promise<void> {
  ensureInitialized();
  const store = useWalletStore.getState();
  store.setConnecting(true);

  try {
    await StellarWalletsKit.authModal();
    store.setConnecting(false);
  } catch (err) {
    store.setError(describeError(err));
  }
}

/**
 * Disconnects the current wallet and clears persisted selection.
 */
export async function disconnectWallet(): Promise<void> {
  ensureInitialized();
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    // Even if the module's own disconnect call fails, clear local state
    // so the UI doesn't get stuck showing a stale "connected" status.
    setPersistedWalletId(null);
    useWalletStore.getState().setAddress(null);
  }
}

/**
 * Call once on app load. If a wallet was connected in a previous session,
 * re-initializes the kit with that wallet selected and refreshes the
 * address. If the wallet is no longer reachable, clears the stale session.
 */
export async function restoreWalletSession(): Promise<void> {
  ensureInitialized();
  const walletId = getPersistedWalletId();
  if (!walletId) return;

  try {
    StellarWalletsKit.setWallet(walletId);
    await StellarWalletsKit.fetchAddress();
  } catch {
    setPersistedWalletId(null);
    useWalletStore.getState().setAddress(null);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Could not connect to the wallet. Please try again.';
}