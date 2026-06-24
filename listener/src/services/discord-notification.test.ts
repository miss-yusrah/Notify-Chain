import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { xdr } from '@stellar/stellar-sdk';
import * as StellarSDK from '@stellar/stellar-sdk';
import { DiscordNotificationService } from './discord-notification';
import { NotificationDeduplicator } from './notification-deduplicator';

const mockFetch = jest.fn() as any;
global.fetch = mockFetch;

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('DiscordNotificationService', () => {
  const mockConfig = {
    webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    webhookId: '123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createMockEvent(
    overrides: Partial<StellarSDK.rpc.Api.EventResponse> = {}
  ): StellarSDK.rpc.Api.EventResponse {
    return {
      id: 'event-123',
      type: 'contract',
      ledger: 1000,
      ledgerClosedAt: '2026-01-01T00:00:00Z',
      transactionIndex: 1,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      txHash: 'abc123',
      topic: [xdr.ScVal.scvSymbol('autoshare_created')],
      value: xdr.ScVal.scvString('test value'),
      ...overrides,
    };
  }

  describe('sendEventNotification', () => {
    it('should send event notification successfully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent();
      const mockContractConfig = { address: 'CA123456789ABCDEF', events: ['autoshare_created'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(mockConfig.webhookUrl);
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
      const body = JSON.parse(options.body);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('autoshare_created');
    });

    it('should handle webhook failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid payload'),
      });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent();
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(false);
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent();
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(false);
    });

    it('should handle request timeout', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const mockLoggerModule = (jest.requireMock('../utils/logger') as any).default;
      const service = new DiscordNotificationService({ ...mockConfig, timeoutMs: 100 });
      const mockEvent = createMockEvent();
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(false);
      expect(mockLoggerModule.error).toHaveBeenCalledWith(
        'Discord webhook request timed out',
        expect.objectContaining({
          webhookId: mockConfig.webhookId,
          timeoutMs: 100,
        })
      );
      expect(service.getMetrics().timeoutCount).toBe(1);
    });
  });

  describe('duplicate detection', () => {
    it('skips the webhook call for a duplicate event', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({ id: 'event-dup' });
      const mockContractConfig = { address: 'CA123456789ABCDEF', events: ['test'] };

      await service.sendEventNotification(mockEvent, mockContractConfig);
      const secondResult = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(secondResult).toBe(true);
      expect(service.getDeduplicationMetrics()).toEqual(
        expect.objectContaining({ skippedDuplicates: 1, cacheSize: 1 })
      );
    });

    it('logs a duplicate detection event', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const mockLoggerModule = (jest.requireMock('../utils/logger') as any).default;
      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({ id: 'event-dup-log' });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      await service.sendEventNotification(mockEvent, mockContractConfig);
      await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(mockLoggerModule.info).toHaveBeenCalledWith(
        'Skipping duplicate notification',
        expect.objectContaining({
          eventId: 'event-dup-log',
          contractAddress: 'CA123',
        })
      );
    });


    it('allows the same notification request after the configured window expires', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      let now = 1000;
      const deduplicator = new NotificationDeduplicator({ windowMs: 500, now: () => now });
      const service = new DiscordNotificationService(mockConfig, deduplicator);
      const mockEvent = createMockEvent({ id: 'event-windowed' });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      await service.sendEventNotification(mockEvent, mockContractConfig);
      await service.sendEventNotification(mockEvent, mockContractConfig);
      now = 1501;
      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(service.getDeduplicationMetrics()).toEqual(
        expect.objectContaining({ acceptedRequests: 2, skippedDuplicates: 1 })
      );
    });

    it('allows the same event id on a different contract through', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({ id: 'event-shared-id' });
      const contractA = { address: 'CONTRACT-A', events: ['test'] };
      const contractB = { address: 'CONTRACT-B', events: ['test'] };

      await service.sendEventNotification(mockEvent, contractA);
      const result = await service.sendEventNotification(mockEvent, contractB);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });

    it('does not mark an event as sent when the webhook call fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error', text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({ id: 'event-retry' });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const firstResult = await service.sendEventNotification(mockEvent, mockContractConfig);
      const secondResult = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(firstResult).toBe(false);
      expect(secondResult).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('accepts an injected deduplicator', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const deduplicator = new NotificationDeduplicator();
      const service = new DiscordNotificationService(mockConfig, deduplicator);
      const mockEvent = createMockEvent({ id: 'event-injected' });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(deduplicator.size()).toBe(1);
      expect(deduplicator.isDuplicate('CA123:event-injected')).toBe(true);
    });
  });

  describe('sendTestMessage', () => {
    it('should send test message successfully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const result = await service.sendTestMessage();

      expect(result).toBe(true);
    });

    it('should handle test message failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new DiscordNotificationService(mockConfig);
      const result = await service.sendTestMessage();

      expect(result).toBe(false);
    });
  });

  describe('formatEventMessage', () => {
    it('should format event with string value correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({
        value: xdr.ScVal.scvString('Hello World'),
      });
      const mockContractConfig = { address: 'CA123456789', events: ['test_event'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(true);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      const valueField = body.embeds[0].fields.find((f: any) => f.name === 'Value');
      expect(valueField.value).toBe('Hello World');
    });

    it('should truncate long string values', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const longValue = 'a'.repeat(600);
      const mockEvent = createMockEvent({
        value: xdr.ScVal.scvString(longValue),
      });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(true);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      const valueField = body.embeds[0].fields.find((f: any) => f.name === 'Value');
      expect(valueField.value.length).toBeLessThan(600);
      expect(valueField.value).toContain('...');
    });

    it('should handle symbol type values', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordNotificationService(mockConfig);
      const mockEvent = createMockEvent({
        value: xdr.ScVal.scvSymbol('my_symbol'),
      });
      const mockContractConfig = { address: 'CA123', events: ['test'] };

      const result = await service.sendEventNotification(mockEvent, mockContractConfig);

      expect(result).toBe(true);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      const valueField = body.embeds[0].fields.find((f: any) => f.name === 'Value');
      expect(valueField.value).toContain('my_symbol');
    });
  });
});
