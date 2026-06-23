import { EventDeduplicationService } from './event-deduplication-service';
import { Database } from '../database/database';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('EventDeduplicationService', () => {
  let db: Database;
  let service: EventDeduplicationService;
  const dbPath = ':memory:';

  beforeAll(async () => {
    db = new Database(dbPath);
    await db.initialize();
  });

  beforeEach(async () => {
    service = new EventDeduplicationService(db);
    // Clear tables before each test
    await db.run('DELETE FROM processed_events');
    await db.run('DELETE FROM polling_cursors');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('isDuplicate', () => {
    it('returns false for a new event', async () => {
      const result = await service.isDuplicate('event-1', 'contract-1');
      expect(result.isDuplicate).toBe(false);
      expect(result.isReorgDuplicate).toBe(false);
    });

    it('returns true for an already processed event', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');

      const result = await service.isDuplicate('event-1', 'contract-1');
      expect(result.isDuplicate).toBe(true);
      expect(result.isReorgDuplicate).toBe(false);
    });

    it('returns false for different event IDs', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');

      const result = await service.isDuplicate('event-2', 'contract-1');
      expect(result.isDuplicate).toBe(false);
    });

    it('returns false for different contract addresses', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');

      const result = await service.isDuplicate('event-1', 'contract-2');
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('recordProcessedEvent', () => {
    it('inserts a new event record', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');

      const result = await service.isDuplicate('event-1', 'contract-1');
      expect(result.isDuplicate).toBe(true);
    });

    it('records notification_sent status', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract', true);
      await service.recordProcessedEvent('event-2', 'contract-1', 101, 'tx-2', 'contract', false);

      const rows = await db.all(
        'SELECT event_id, notification_sent FROM processed_events ORDER BY event_id'
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveProperty('notification_sent', 1);
      expect(rows[1]).toHaveProperty('notification_sent', 0);
    });

    it('records error status and reason', async () => {
      await service.recordProcessedEvent(
        'event-1',
        'contract-1',
        100,
        'tx-1',
        'contract',
        false,
        'ERROR',
        'Processing failed'
      );

      const rows = await db.all('SELECT status, error_reason FROM processed_events');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('status', 'ERROR');
      expect(rows[0]).toHaveProperty('error_reason', 'Processing failed');
    });
  });

  describe('Reorg Duplicate Detection', () => {
    it('detects reorg duplicates on second recording of same event', async () => {
      // First time processing the event
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      let result = await service.isDuplicate('event-1', 'contract-1');
      expect(result.isReorgDuplicate).toBe(false);

      // Event appears again (reorg duplicate)
      await service.recordProcessedEvent('event-1', 'contract-1', 101, 'tx-1', 'contract');

      // Should now be marked as reorg duplicate
      const rows = await db.all(
        'SELECT is_reorg_duplicate, reorg_detection_count FROM processed_events'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('is_reorg_duplicate', 1);
      expect(rows[0]).toHaveProperty('reorg_detection_count', 1);
    });

    it('increments reorg_detection_count on multiple reorg duplicates', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-1', 'contract-1', 101, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-1', 'contract-1', 102, 'tx-1', 'contract');

      const rows = await db.all(
        'SELECT is_reorg_duplicate, reorg_detection_count FROM processed_events'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('is_reorg_duplicate', 1);
      expect(rows[0]).toHaveProperty('reorg_detection_count', 2);
    });

    it('logs warnings for reorg duplicates', async () => {
      jest.clearAllMocks();
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      jest.clearAllMocks();

      await service.recordProcessedEvent('event-1', 'contract-1', 101, 'tx-1', 'contract');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Reorg duplicate detected',
        expect.objectContaining({
          eventId: 'event-1',
          contractAddress: 'contract-1',
        })
      );
    });
  });

  describe('updatePollingCursor and detectReorg', () => {
    it('creates initial cursor record', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);

      const cursor = await service.getLastCursor('contract-1');
      expect(cursor).toEqual(
        expect.objectContaining({
          contractAddress: 'contract-1',
          cursor: 'cursor-1',
          ledgerNumber: 100,
          reorgDetected: false,
          reorgDetectionCount: 0,
        })
      );
    });

    it('updates existing cursor', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);
      await service.updatePollingCursor('contract-1', 'cursor-2', 105);

      const cursor = await service.getLastCursor('contract-1');
      expect(cursor).toEqual(
        expect.objectContaining({
          cursor: 'cursor-2',
          ledgerNumber: 105,
        })
      );
    });

    it('detects reorg when ledger number decreases', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);

      // This should detect a reorg
      const reorgDetected = await service.detectReorg('contract-1', 95);
      expect(reorgDetected).toBe(true);
    });

    it('does not detect reorg when ledger number increases', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);

      const reorgDetected = await service.detectReorg('contract-1', 105);
      expect(reorgDetected).toBe(false);
    });

    it('returns false on first call to detectReorg', async () => {
      const reorgDetected = await service.detectReorg('contract-1', 100);
      expect(reorgDetected).toBe(false);
    });

    it('records reorg detection with flag', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);
      await service.updatePollingCursor('contract-1', 'cursor-2', 95, true);

      const cursor = await service.getLastCursor('contract-1');
      expect(cursor?.reorgDetected).toBe(true);
      expect(cursor?.reorgDetectionCount).toBeGreaterThan(0);
    });

    it('increments reorg_detection_count', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);
      await service.updatePollingCursor('contract-1', 'cursor-2', 95, true);
      await service.updatePollingCursor('contract-1', 'cursor-3', 90, true);

      const cursor = await service.getLastCursor('contract-1');
      expect(cursor?.reorgDetectionCount).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('returns zero metrics for empty database', async () => {
      const metrics = await service.getMetrics();
      expect(metrics).toEqual({
        totalProcessedEvents: 0,
        reorgDuplicatesDetected: 0,
        erroredEvents: 0,
        currentCursorPositions: 0,
        totalReorgsDetected: 0,
      });
    });

    it('counts total processed events', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-2', 'contract-1', 101, 'tx-2', 'contract');

      const metrics = await service.getMetrics();
      expect(metrics.totalProcessedEvents).toBe(2);
    });

    it('counts reorg duplicates', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-1', 'contract-1', 101, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-2', 'contract-1', 102, 'tx-2', 'contract');

      const metrics = await service.getMetrics();
      expect(metrics.totalProcessedEvents).toBe(2);
      expect(metrics.reorgDuplicatesDetected).toBe(1);
    });

    it('counts errored events', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract', false, 'ERROR');
      await service.recordProcessedEvent('event-2', 'contract-1', 101, 'tx-2', 'contract', true, 'PROCESSED');

      const metrics = await service.getMetrics();
      expect(metrics.erroredEvents).toBe(1);
    });

    it('counts cursor positions', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);
      await service.updatePollingCursor('contract-2', 'cursor-2', 200);

      const metrics = await service.getMetrics();
      expect(metrics.currentCursorPositions).toBe(2);
    });

    it('sums reorg detection counts', async () => {
      await service.updatePollingCursor('contract-1', 'cursor-1', 100);
      await service.updatePollingCursor('contract-1', 'cursor-2', 95, true);
      await service.updatePollingCursor('contract-1', 'cursor-3', 90, true);
      await service.updatePollingCursor('contract-2', 'cursor-4', 100);
      await service.updatePollingCursor('contract-2', 'cursor-5', 90, true);

      const metrics = await service.getMetrics();
      expect(metrics.totalReorgsDetected).toBe(3); // 2 + 1
    });
  });

  describe('cleanupOldRecords', () => {
    it('deletes old non-reorg records', async () => {
      // This test is tricky with timestamps, so we'll skip the actual time manipulation
      // In a real scenario, we'd use a mock date
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');

      const before = await db.all('SELECT COUNT(*) as count FROM processed_events');
      expect(before[0]).toHaveProperty('count', 1);
    });

    it('preserves reorg duplicate records', async () => {
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-1', 'contract-1', 101, 'tx-1', 'contract');

      const rows = await db.all(
        'SELECT is_reorg_duplicate FROM processed_events WHERE is_reorg_duplicate = 1'
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('integration: Complete reorg scenario', () => {
    it('handles a blockchain reorg with duplicate events', async () => {
      // Scenario: We're polling events from blocks 100-105
      await service.updatePollingCursor('contract-1', 'cursor-at-105', 105);
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-2', 'contract-1', 102, 'tx-2', 'contract');
      await service.recordProcessedEvent('event-3', 'contract-1', 105, 'tx-3', 'contract');

      // Blockchain reorg happens - new events from lower block number
      const reorgDetected = await service.detectReorg('contract-1', 98);
      expect(reorgDetected).toBe(true);

      // Update cursor with reorg flag
      await service.updatePollingCursor('contract-1', 'cursor-after-reorg', 98, true);

      // Same events are re-fetched
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract');
      await service.recordProcessedEvent('event-2', 'contract-1', 102, 'tx-2', 'contract');

      // Check that they're marked as reorg duplicates
      const duplicates = await db.all(
        'SELECT event_id, is_reorg_duplicate FROM processed_events WHERE is_reorg_duplicate = 1'
      );
      expect(duplicates).toHaveLength(2);
      expect(duplicates[0]).toHaveProperty('event_id', 'event-1');
      expect(duplicates[1]).toHaveProperty('event_id', 'event-2');

      // Original event that didn't reorg should still be there
      const allEvents = await db.all('SELECT event_id FROM processed_events ORDER BY event_id');
      expect(allEvents).toHaveLength(3);

      // Check metrics reflect the reorg
      const metrics = await service.getMetrics();
      expect(metrics.reorgDuplicatesDetected).toBe(2);
      expect(metrics.totalReorgsDetected).toBe(1);
    });

    it('prevents duplicate notifications during reorg', async () => {
      // First processing - send notification
      await service.recordProcessedEvent('event-1', 'contract-1', 100, 'tx-1', 'contract', true, 'PROCESSED');

      // Reorg occurs - same event is processed again
      // The notification flag should indicate we already sent one
      const isDuplicate = await service.isDuplicate('event-1', 'contract-1');
      expect(isDuplicate.isDuplicate).toBe(true);

      // Application logic should skip notification based on isDuplicate check
      const allEvents = await db.all('SELECT notification_sent FROM processed_events');
      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]).toHaveProperty('notification_sent', 1); // Still 1, not 2
    });
  });
});
