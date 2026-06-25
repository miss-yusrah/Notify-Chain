import { Database } from '../database/database';
import logger from '../utils/logger';
import { generateFingerprint } from './notification-deduplicator';

export interface ProcessedEventRecord {
  eventId: string;
  contractAddress: string;
  fingerprint: string;
  ledgerNumber: number;
  txHash?: string;
  eventType: string;
  isReorgDuplicate: boolean;
  reorgDetectionCount: number;
  notificationSent: boolean;
  status: 'PROCESSED' | 'SKIPPED' | 'ERROR';
  errorReason?: string;
}

export interface PollingCursorRecord {
  contractAddress: string;
  cursor: string;
  ledgerNumber: number;
  reorgDetected: boolean;
  reorgDetectionCount: number;
}

export interface DeduplicationMetrics {
  totalProcessedEvents: number;
  reorgDuplicatesDetected: number;
  erroredEvents: number;
  currentCursorPositions: number;
  totalReorgsDetected: number;
}

/**
 * Event Deduplication Service
 *
 * Provides persistent, database-backed deduplication of blockchain events.
 * Ensures idempotent event processing even after:
 * - Service restarts
 * - Network reorgs (blockchain reorganizations)
 * - Cursor resets
 *
 * This service complements the in-memory NotificationDeduplicator by adding
 * long-term, permanent deduplication across service instances and restarts.
 */
export class EventDeduplicationService {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /**
   * Check if an event has already been processed
   * Returns true if the event exists in the database (indicating it was already processed)
   */
  async isDuplicate(
    eventId: string,
    contractAddress: string
  ): Promise<{ isDuplicate: boolean; isReorgDuplicate: boolean }> {
    try {
      const fingerprint = generateFingerprint(eventId, contractAddress);
      const rows = await this.db.all(
        `
        SELECT event_id, is_reorg_duplicate 
        FROM processed_events 
        WHERE fingerprint = ?
        LIMIT 1
        `,
        [fingerprint]
      );

      if (rows.length === 0) {
        return { isDuplicate: false, isReorgDuplicate: false };
      }

      const record = rows[0] as any;
      return {
        isDuplicate: true,
        isReorgDuplicate: record.is_reorg_duplicate === 1,
      };
    } catch (error) {
      logger.error('Error checking for duplicate event', {
        eventId,
        contractAddress,
        error,
      });
      // On error, fail open (allow processing) to avoid cascading failures
      return { isDuplicate: false, isReorgDuplicate: false };
    }
  }

  /**
   * Record that an event has been processed
   */
  async recordProcessedEvent(
    eventId: string,
    contractAddress: string,
    ledgerNumber: number,
    txHash: string | undefined,
    eventType: string,
    notificationSent: boolean = true,
    status: 'PROCESSED' | 'SKIPPED' | 'ERROR' = 'PROCESSED',
    errorReason?: string
  ): Promise<void> {
    try {
      const fingerprint = generateFingerprint(eventId, contractAddress);

      // Check if this event already exists (reorg duplicate detection)
      const existingRows = await this.db.all(
        `
        SELECT id, is_reorg_duplicate, reorg_detection_count 
        FROM processed_events 
        WHERE fingerprint = ?
        LIMIT 1
        `,
        [fingerprint]
      );

      if (existingRows.length > 0) {
        // This is a reorg duplicate - update the record instead of inserting
        const existing = existingRows[0] as any;
        const newCount = (existing.reorg_detection_count || 0) + 1;

        await this.db.run(
          `
          UPDATE processed_events 
          SET 
            is_reorg_duplicate = 1,
            reorg_detection_count = ?,
            last_redetected_at = CURRENT_TIMESTAMP,
            status = ?,
            ledger_number = ?
          WHERE fingerprint = ?
          `,
          [newCount, status, ledgerNumber, fingerprint]
        );

        logger.warn('Reorg duplicate detected', {
          eventId,
          contractAddress,
          fingerprint,
          reorgDetectionCount: newCount,
          ledgerNumber,
        });
        return;
      }

      // Insert new processed event record
      await this.db.run(
        `
        INSERT INTO processed_events (
          event_id, contract_address, fingerprint, ledger_number, tx_hash, 
          event_type, notification_sent, status, error_reason, is_reorg_duplicate
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `,
        [eventId, contractAddress, fingerprint, ledgerNumber, txHash, eventType, notificationSent ? 1 : 0, status, errorReason]
      );

      logger.info('Event processed and recorded', {
        eventId,
        contractAddress,
        fingerprint,
        ledgerNumber,
        notificationSent,
      });
    } catch (error) {
      logger.error('Error recording processed event', {
        eventId,
        contractAddress,
        error,
      });
      // Don't throw - allow processing to continue even if DB write fails
    }
  }

  /**
   * Update or create a polling cursor for a contract
   * Used to track the last known position for reorg detection
   */
  async updatePollingCursor(
    contractAddress: string,
    cursor: string,
    ledgerNumber: number,
    reorgDetected: boolean = false
  ): Promise<void> {
    try {
      const rows = await this.db.all(
        `
        SELECT id, reorg_detection_count 
        FROM polling_cursors 
        WHERE contract_address = ?
        LIMIT 1
        `,
        [contractAddress]
      );

      if (rows.length > 0) {
        const existing = rows[0] as any;
        const reorgCount = reorgDetected ? (existing.reorg_detection_count || 0) + 1 : existing.reorg_detection_count;

        await this.db.run(
          `
          UPDATE polling_cursors 
          SET 
            cursor = ?,
            ledger_number = ?,
            reorg_detected = ?,
            reorg_detection_count = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE contract_address = ?
          `,
          [cursor, ledgerNumber, reorgDetected ? 1 : 0, reorgCount, contractAddress]
        );
      } else {
        await this.db.run(
          `
          INSERT INTO polling_cursors (
            contract_address, cursor, ledger_number, reorg_detected, reorg_detection_count
          )
          VALUES (?, ?, ?, ?, 0)
          `,
          [contractAddress, cursor, ledgerNumber, reorgDetected ? 1 : 0]
        );
      }

      if (reorgDetected) {
        logger.warn('Reorg detected and recorded', {
          contractAddress,
          cursor,
          ledgerNumber,
        });
      }
    } catch (error) {
      logger.error('Error updating polling cursor', {
        contractAddress,
        cursor,
        ledgerNumber,
        error,
      });
    }
  }

  /**
   * Get the last known cursor for a contract
   */
  async getLastCursor(contractAddress: string): Promise<PollingCursorRecord | null> {
    try {
      const rows = await this.db.all(
        `
        SELECT 
          contract_address, cursor, ledger_number, 
          reorg_detected, reorg_detection_count
        FROM polling_cursors 
        WHERE contract_address = ?
        LIMIT 1
        `,
        [contractAddress]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0] as any;
      return {
        contractAddress: row.contract_address,
        cursor: row.cursor,
        ledgerNumber: row.ledger_number,
        reorgDetected: row.reorg_detected === 1,
        reorgDetectionCount: row.reorg_detection_count || 0,
      };
    } catch (error) {
      logger.error('Error retrieving last cursor', {
        contractAddress,
        error,
      });
      return null;
    }
  }

  /**
   * Check if a reorg is likely by comparing ledger numbers
   * If the new ledger is less than the previous ledger, a reorg likely occurred
   */
  async detectReorg(contractAddress: string, newLedgerNumber: number): Promise<boolean> {
    try {
      const lastCursor = await this.getLastCursor(contractAddress);
      if (!lastCursor) {
        // First time seeing this contract
        return false;
      }

      const reorgDetected = newLedgerNumber < lastCursor.ledgerNumber;
      if (reorgDetected) {
        logger.warn('Blockchain reorg detected', {
          contractAddress,
          previousLedger: lastCursor.ledgerNumber,
          newLedger: newLedgerNumber,
        });
      }

      return reorgDetected;
    } catch (error) {
      logger.error('Error detecting reorg', {
        contractAddress,
        newLedgerNumber,
        error,
      });
      return false;
    }
  }

  /**
   * Get comprehensive deduplication metrics
   */
  async getMetrics(): Promise<DeduplicationMetrics> {
    try {
      const processedRows = await this.db.all(
        `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_reorg_duplicate = 1 THEN 1 ELSE 0 END) as reorg_duplicates,
          SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as errors
        FROM processed_events
        `
      );

      const cursorRows = await this.db.all(
        `
        SELECT COUNT(*) as count FROM polling_cursors
        `
      );

      const reorgRows = await this.db.all(
        `
        SELECT SUM(reorg_detection_count) as total FROM polling_cursors
        `
      );

      const processedData = processedRows[0] as any;
      const cursorData = cursorRows[0] as any;
      const reorgData = reorgRows[0] as any;

      return {
        totalProcessedEvents: processedData.total || 0,
        reorgDuplicatesDetected: processedData.reorg_duplicates || 0,
        erroredEvents: processedData.errors || 0,
        currentCursorPositions: cursorData.count || 0,
        totalReorgsDetected: reorgData.total || 0,
      };
    } catch (error) {
      logger.error('Error retrieving deduplication metrics', { error });
      return {
        totalProcessedEvents: 0,
        reorgDuplicatesDetected: 0,
        erroredEvents: 0,
        currentCursorPositions: 0,
        totalReorgsDetected: 0,
      };
    }
  }

  /**
   * Clean up old processed event records (older than the specified number of days)
   * Keeps recent history for monitoring while reducing database size
   */
  async cleanupOldRecords(daysToKeep: number = 30): Promise<number> {
    try {
      const result = await this.db.run(
        `
        DELETE FROM processed_events 
        WHERE processed_at < datetime('now', '-' || ? || ' days')
          AND is_reorg_duplicate = 0
        `,
        [daysToKeep]
      );

      logger.info('Cleaned up old event records', {
        daysToKeep,
        recordsDeleted: result.changes,
      });

      return result.changes;
    } catch (error) {
      logger.error('Error cleaning up old records', {
        daysToKeep,
        error,
      });
      return 0;
    }
  }
}
