/**
 * ArchiveService
 *
 * Background worker that enforces the notification retention policy:
 *
 *   Phase 1 – Archive
 *     Every `intervalMs`, rows in `scheduled_notifications` with a terminal
 *     status (COMPLETED | FAILED | CANCELLED) whose `processing_completed_at`
 *     is older than `archiveAfterMs` are MOVED (copy + delete) into the
 *     `notification_archive` table.  Processing is capped at `batchSize` rows
 *     per cycle to keep individual transactions short.
 *
 *   Phase 2 – Purge
 *     Within the same cycle, rows in `notification_archive` whose `archived_at`
 *     is older than `deleteAfterMs` are permanently deleted (when deleteAfterMs > 0).
 *
 * Both phases run inside the same `setInterval` tick so that the full
 * retention policy is applied atomically per cycle.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Database } from '../database/database';
import { ArchiveConfig } from './archive-config';
import { ArchiveStore } from './archive-store';
import logger from '../utils/logger';

/** Shape of the raw SQLite row from scheduled_notifications. */
interface NotificationRow {
  id: number;
  payload: string;
  notification_type: string;
  target_recipient: string;
  execute_at: string;
  created_at: string;
  processing_completed_at: string | null;
  status: string;
  retry_count: number;
  last_error: string | null;
  event_id: string | null;
  contract_address: string | null;
  metadata: string | null;
}

export interface ArchiveCycleResult {
  archived: number;
  purged: number;
  durationMs: number;
}

export class ArchiveService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly store: ArchiveStore;

  constructor(
    private readonly db: Database,
    private readonly config: ArchiveConfig,
  ) {
    this.store = new ArchiveStore(db);
  }

  /** Ensure the archive schema exists (idempotent). */
  async initialize(): Promise<void> {
    const schemaPath = path.join(__dirname, '../database/archive-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Archive schema not found: ${schemaPath}`);
    }
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await this.db.exec(sql);
    logger.info('ArchiveService: schema ready');
  }

  start(): void {
    if (this.timer) return;
    logger.info('ArchiveService started', {
      intervalMs: this.config.intervalMs,
      archiveAfterMs: this.config.archiveAfterMs,
      deleteAfterMs: this.config.deleteAfterMs,
      batchSize: this.config.batchSize,
    });
    // Run immediately on start, then on the configured interval.
    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('ArchiveService stopped');
  }

  /**
   * Run one full archive + purge cycle.
   * Exposed publicly so callers (tests, admin tooling) can trigger on demand.
   */
  async runCycle(): Promise<ArchiveCycleResult> {
    const t0 = Date.now();
    let archived = 0;
    let purged = 0;

    try {
      archived = await this._archiveOldNotifications();
      purged = await this._purgeExpiredArchive();
    } catch (err) {
      logger.error('ArchiveService: cycle error', { error: err });
    }

    const durationMs = Date.now() - t0;
    logger.info('ArchiveService: cycle complete', { archived, purged, durationMs });
    return { archived, purged, durationMs };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _archiveOldNotifications(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.archiveAfterMs).toISOString();

    const rows = await this.db.all<NotificationRow>(
      `SELECT id, payload, notification_type, target_recipient, execute_at,
              created_at, processing_completed_at, status, retry_count,
              last_error, event_id, contract_address, metadata
       FROM scheduled_notifications
       WHERE status IN ('COMPLETED','FAILED','CANCELLED')
         AND processing_completed_at IS NOT NULL
         AND processing_completed_at < ?
       ORDER BY processing_completed_at ASC
       LIMIT ?`,
      [cutoff, this.config.batchSize],
    );

    if (rows.length === 0) return 0;

    // Copy to archive, then delete originals — done inside a transaction.
    let inserted = 0;
    await this.db.transaction(async () => {
      inserted = await this.store.insertBatch(
        rows.map((r) => ({
          originalId: r.id,
          payload: r.payload,
          notificationType: r.notification_type,
          targetRecipient: r.target_recipient,
          executeAt: r.execute_at,
          createdAt: r.created_at,
          processingCompletedAt: r.processing_completed_at,
          status: r.status,
          retryCount: r.retry_count,
          lastError: r.last_error,
          eventId: r.event_id,
          contractAddress: r.contract_address,
          metadata: r.metadata,
        })),
      );

      // Remove originals
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      await this.db.run(
        `DELETE FROM scheduled_notifications WHERE id IN (${placeholders})`,
        ids,
      );
    });

    logger.info('ArchiveService: archived notifications', { count: inserted, cutoff });
    return inserted;
  }

  private async _purgeExpiredArchive(): Promise<number> {
    if (!this.config.deleteAfterMs) return 0;

    const cutoff = new Date(Date.now() - this.config.deleteAfterMs).toISOString();
    const purged = await this.store.purgeOlderThan(cutoff);

    if (purged > 0) {
      logger.info('ArchiveService: purged expired archive records', { count: purged, cutoff });
    }
    return purged;
  }
}
