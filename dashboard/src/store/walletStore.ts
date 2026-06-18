import { create } from 'zustand';

export interface WalletState {
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  setAddress: (address: string | null) => void;
  setConnecting: (isConnecting: boolean) => void;
  setError: (error: string | null) => void;
}

const STORAGE_KEY = 'notify-chain:wallet-id';

export function getPersistedWalletId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setPersistedWalletId(walletId: string | null): void {
  try {
    if (walletId) {
      localStorage.setItem(STORAGE_KEY, walletId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private browsing, etc.) — connection
    // still works for the session, it just won't persist across reloads.
  }
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  isConnecting: false,
  error: null,

  setAddress: (address) => set({ address, error: null }),
  setConnecting: (isConnecting) => set({ isConnecting }),
  setError: (error) => set({ error, isConnecting: false }),
}));