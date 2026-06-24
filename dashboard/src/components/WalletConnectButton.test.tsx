import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import * as kitReal from '@creit.tech/stellar-wallets-kit';
import { WalletConnectButton } from './WalletConnectButton';
import { useWalletStore } from '../store/walletStore';
import { restoreWalletSession } from '../services/wallet';

const kit = kitReal as unknown as typeof import('../test/stellarWalletsKitMock');

const WALLET_ID_KEY = 'notify-chain:wallet-id';
const WALLET_ADDRESS_KEY = 'notify-chain:wallet-address';

beforeEach(() => {
  localStorage.clear();
  useWalletStore.setState({
    address: null,
    isConnecting: false,
    isReconnecting: false,
    error: null,
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('WalletConnectButton reconnection behaviour', () => {
  it('shows a connected address that was restored from a previous session', () => {
    useWalletStore.getState().setAddress('GABCDEFGHIJKLMNOP');

    render(<WalletConnectButton />);

    expect(screen.getByText('GABCDE...MNOP')).toBeInTheDocument();
    expect(screen.getByLabelText('Disconnect wallet')).toBeInTheDocument();
  });

  it('keeps the connected UI through a transient reconnection blip', async () => {
    localStorage.setItem(WALLET_ID_KEY, 'freighter');
    localStorage.setItem(WALLET_ADDRESS_KEY, 'GABCDEFGHIJKLMNOP');
    useWalletStore.getState().setAddress('GABCDEFGHIJKLMNOP');

    render(<WalletConnectButton />);
    expect(screen.getByLabelText('Disconnect wallet')).toBeInTheDocument();

    // Registers the kit's event handlers via the service's ensureInitialized().
    await act(async () => {
      await restoreWalletSession();
    });

    // A transient null state-update mid-reconnect must NOT drop the session.
    act(() => {
      kit.__emit('STATE_UPDATED', { address: null });
    });

    expect(screen.getByLabelText('Disconnect wallet')).toBeInTheDocument();
    expect(screen.queryByText('Connect Wallet')).not.toBeInTheDocument();
  });
});
