import { xdr } from '@stellar/stellar-sdk';
import * as StellarSDK from '@stellar/stellar-sdk';
import { EventSubscriber } from './event-subscriber';
import { Config, ContractConfig } from '../types';
import logger from '../utils/logger';

const mockGetEvents = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getEvents: mockGetEvents,
      })),
    },
  };
});

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockLogger = logger as jest.Mocked<typeof logger>;

const contractConfig: ContractConfig = {
  address: 'CCEMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5',
  events: ['*'],
};

const testConfig: Config = {
  stellarNetwork: 'testnet',
  stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
  contractAddresses: [contractConfig],
  pollIntervalMs: 30000,
  maxReconnectAttempts: 5,
  reconnectDelayMs: 100,
};

function createMockEvent(
  overrides: Partial<StellarSDK.rpc.Api.EventResponse> = {}
): StellarSDK.rpc.Api.EventResponse {
  return {
    id: 'event-1',
    type: 'contract',
    ledger: 12345,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: 'abc123def456',
    topic: [xdr.ScVal.scvSymbol('TaskCreated')],
    value: xdr.ScVal.scvU32(1),
    ...overrides,
  };
}

function countLogCalls(level: 'info' | 'warn' | 'error', message: string): number {
  const mock = mockLogger[level] as jest.Mock;
  return mock.mock.calls.filter((call: unknown[]) => call[0] === message).length;
}

describe('EventSubscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEvents.mockResolvedValue({ events: [], cursor: '' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('lifecycle', () => {
    it('should create an instance', () => {
      const subscriber = new EventSubscriber(testConfig);
      expect(subscriber).toBeDefined();
    });

    it('should start and stop without errors', async () => {
      jest.useFakeTimers();

      const subscriber = new EventSubscriber(testConfig);
      await subscriber.start();
      await jest.advanceTimersByTimeAsync(0);
      await subscriber.stop();
    });
  });

  describe('successful event processing', () => {
    it('processes and logs events returned from RPC', async () => {
      const event = createMockEvent({ id: 'event-abc', ledger: 99999 });
      mockGetEvents.mockResolvedValue({
        events: [event],
        cursor: 'cursor-1',
      });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(mockGetEvents).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received events',
        expect.objectContaining({
          contractAddress: contractConfig.address,
          count: 1,
          processed: 1,
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing event',
        expect.objectContaining({
          contractAddress: contractConfig.address,
          eventName: 'TaskCreated',
          ledger: 99999,
          type: 'contract',
        })
      );
    });

    it('processes each valid event in a batch', async () => {
      mockGetEvents.mockResolvedValue({
        events: [
          createMockEvent({ id: 'event-1' }),
          createMockEvent({ id: 'event-2' }),
          createMockEvent({ id: 'event-3' }),
        ],
        cursor: 'cursor-batch',
      });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(countLogCalls('info', 'Processing event')).toBe(3);
    });

    it('does not log received events when RPC returns an empty list', async () => {
      mockGetEvents.mockResolvedValue({ events: [], cursor: 'cursor-empty' });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(countLogCalls('info', 'Received events')).toBe(0);
    });

    it('uses startLedger on the first fetch and cursor on subsequent fetches', async () => {
      mockGetEvents
        .mockResolvedValueOnce({
          events: [createMockEvent()],
          cursor: 'cursor-next',
        })
        .mockResolvedValueOnce({ events: [], cursor: 'cursor-next' });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();
      await (subscriber as any).checkForEvents();

      expect(mockGetEvents.mock.calls[0][0]).toMatchObject({ startLedger: 1 });
      expect(mockGetEvents.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-next' });
    });

    it('tracks cursors independently per contract', async () => {
      const secondContract: ContractConfig = {
        address: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        events: ['*'],
      };
      const multiContractConfig: Config = {
        ...testConfig,
        contractAddresses: [contractConfig, secondContract],
      };

      mockGetEvents
        .mockResolvedValueOnce({
          events: [createMockEvent({ id: 'contract-a' })],
          cursor: 'cursor-a',
        })
        .mockResolvedValueOnce({
          events: [createMockEvent({ id: 'contract-b' })],
          cursor: 'cursor-b',
        });

      const subscriber = new EventSubscriber(multiContractConfig);
      await (subscriber as any).checkForEvents();
      await (subscriber as any).checkForEvents();

      expect(mockGetEvents.mock.calls[2][0]).toMatchObject({ cursor: 'cursor-a' });
      expect(mockGetEvents.mock.calls[3][0]).toMatchObject({ cursor: 'cursor-b' });
    });

    it('fetches events for every configured contract', async () => {
      const secondContract: ContractConfig = {
        address: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        events: ['TaskCreated'],
      };
      const multiContractConfig: Config = {
        ...testConfig,
        contractAddresses: [contractConfig, secondContract],
      };

      mockGetEvents.mockResolvedValue({ events: [], cursor: '' });

      const subscriber = new EventSubscriber(multiContractConfig);
      await (subscriber as any).checkForEvents();

      expect(mockGetEvents).toHaveBeenCalledTimes(2);
      expect(mockGetEvents.mock.calls[0][0].filters[0].contractIds).toEqual([
        contractConfig.address,
      ]);
      expect(mockGetEvents.mock.calls[1][0].filters[0].contractIds).toEqual([
        secondContract.address,
      ]);
    });

    it('filters events using contract-specific event names', async () => {
      const filteredConfig: Config = {
        ...testConfig,
        contractAddresses: [
          {
            ...contractConfig,
            events: ['TaskCreated'],
          },
        ],
      };

      mockGetEvents.mockResolvedValue({
        events: [
          createMockEvent({
            id: 'matched',
            topic: [xdr.ScVal.scvSymbol('TaskCreated')],
          }),
          createMockEvent({
            id: 'skipped',
            topic: [xdr.ScVal.scvSymbol('WorkSubmitted')],
          }),
        ],
        cursor: 'cursor-filtered',
      });

      const subscriber = new EventSubscriber(filteredConfig);
      await (subscriber as any).checkForEvents();

      expect(countLogCalls('info', 'Processing event')).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing event',
        expect.objectContaining({ eventName: 'TaskCreated' })
      );
    });
  });

  describe('invalid event payloads', () => {
    it('skips events with an empty topic when specific filters are configured', async () => {
      const filteredConfig: Config = {
        ...testConfig,
        contractAddresses: [
          {
            ...contractConfig,
            events: ['TaskCreated'],
          },
        ],
      };

      mockGetEvents.mockResolvedValue({
        events: [createMockEvent({ id: 'empty-topic', topic: [] })],
        cursor: 'cursor-empty-topic',
      });

      const subscriber = new EventSubscriber(filteredConfig);
      await (subscriber as any).checkForEvents();

      expect(countLogCalls('info', 'Processing event')).toBe(0);
    });

    it('warns and skips events missing required fields', async () => {
      const invalidEvent = {
        id: 'invalid',
        type: 'contract',
      } as StellarSDK.rpc.Api.EventResponse;

      mockGetEvents.mockResolvedValue({
        events: [invalidEvent],
        cursor: 'cursor-invalid',
      });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Skipping invalid event payload',
        expect.objectContaining({
          contractAddress: contractConfig.address,
          eventId: 'invalid',
        })
      );
      expect(countLogCalls('info', 'Processing event')).toBe(0);
    });

    it('warns and skips events with undefined value field', async () => {
      const invalidEvent = createMockEvent({ id: 'missing-value' });
      (invalidEvent as any).value = undefined;

      mockGetEvents.mockResolvedValue({
        events: [invalidEvent],
        cursor: 'cursor-missing-value',
      });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Skipping invalid event payload',
        expect.objectContaining({
          eventId: 'missing-value',
          reason: 'Missing event value',
        })
      );
      expect(countLogCalls('info', 'Processing event')).toBe(0);
    });

    it('processes valid events and skips invalid ones in the same batch', async () => {
      mockGetEvents.mockResolvedValue({
        events: [
          createMockEvent({ id: 'valid' }),
          { id: 'invalid', type: 'contract' } as StellarSDK.rpc.Api.EventResponse,
        ],
        cursor: 'cursor-mixed',
      });

      const subscriber = new EventSubscriber(testConfig);
      await (subscriber as any).checkForEvents();

      expect(countLogCalls('info', 'Processing event')).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Skipping invalid event payload',
        expect.objectContaining({ eventId: 'invalid' })
      );
    });
  });

  describe('error scenarios', () => {
    it('logs an error when RPC fetch fails for a contract', async () => {
      const rpcError = new Error('RPC unavailable');
      mockGetEvents.mockRejectedValue(rpcError);

      const subscriber = new EventSubscriber(testConfig);
      await expect((subscriber as any).checkForEvents()).rejects.toThrow(
        'Failed to fetch events for all 1 configured contract(s)'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching events for contract',
        expect.objectContaining({
          contractAddress: contractConfig.address,
          error: rpcError,
        })
      );
    });

    it('continues fetching events for remaining contracts after a failure', async () => {
      const secondContract: ContractConfig = {
        address: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        events: ['*'],
      };
      const multiContractConfig: Config = {
        ...testConfig,
        contractAddresses: [contractConfig, secondContract],
      };

      mockGetEvents
        .mockRejectedValueOnce(new Error('first contract failed'))
        .mockResolvedValueOnce({
          events: [createMockEvent({ id: 'recovered' })],
          cursor: 'cursor-ok',
        });

      const subscriber = new EventSubscriber(multiContractConfig);
      await (subscriber as any).checkForEvents();

      expect(mockGetEvents).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching events for contract',
        expect.objectContaining({ contractAddress: contractConfig.address })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received events',
        expect.objectContaining({ contractAddress: secondContract.address })
      );
    });

    it('triggers poll-level reconnection when every contract fetch fails', async () => {
      jest.useFakeTimers();
      mockGetEvents.mockRejectedValue(new Error('RPC down'));

      const subscriber = new EventSubscriber({
        ...testConfig,
        pollIntervalMs: 5000,
        reconnectDelayMs: 100,
      });

      await subscriber.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error polling for events',
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Attempting to reconnect',
        expect.objectContaining({ attempt: 1 })
      );

      await subscriber.stop();
    });

    it('stops the service after exceeding max reconnection attempts', async () => {
      const subscriber = new EventSubscriber({
        ...testConfig,
        maxReconnectAttempts: 3,
      });
      (subscriber as any).reconnectAttempts = 3;

      const stopSpy = jest.spyOn(subscriber, 'stop');
      await (subscriber as any).handleReconnection();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Max reconnection attempts exceeded, stopping service'
      );
      expect(stopSpy).toHaveBeenCalled();
    });

    it('applies incremental backoff delay between reconnection attempts', async () => {
      jest.useFakeTimers();

      const subscriber = new EventSubscriber({
        ...testConfig,
        reconnectDelayMs: 200,
      });
      (subscriber as any).reconnectAttempts = 1;

      const reconnectPromise = (subscriber as any).handleReconnection();

      expect(mockLogger.warn).toHaveBeenCalledWith('Attempting to reconnect', {
        attempt: 2,
        delayMs: 400,
      });

      await jest.advanceTimersByTimeAsync(400);
      await reconnectPromise;

      expect((subscriber as any).reconnectAttempts).toBe(2);
    });

    it('resets reconnection counter after a successful poll cycle', async () => {
      jest.useFakeTimers();
      mockGetEvents.mockResolvedValue({ events: [], cursor: '' });

      const subscriber = new EventSubscriber({
        ...testConfig,
        pollIntervalMs: 1000,
      });
      (subscriber as any).reconnectAttempts = 2;

      await subscriber.start();
      await jest.advanceTimersByTimeAsync(0);
      await subscriber.stop();

      expect((subscriber as any).reconnectAttempts).toBe(0);
    });
  });
});
