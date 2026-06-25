/**
 * Archive configuration loaded from environment variables.
 *
 * Retention policy (applied per archiving cycle):
 *   1. Notifications older than `archiveAfterMs` are MOVED from
 *      `scheduled_notifications` into `notification_archive`.
 *   2. Records in `notification_archive` older than `deleteAfterMs`
 *      are permanently deleted.
 *
 * Timeline example (defaults):
 *   Day 0  – notification completes
 *   Day 7  – notification is archived (moved to archive table)
 *   Day 90 – archived record is permanently deleted
 */
export interface ArchiveConfig {
  /** Whether the archiving background worker is enabled. Default: true. */
  enabled: boolean;
  /** How often to run the archive cycle (ms). Default: 6 hours. */
  intervalMs: number;
  /**
   * Move completed/failed/cancelled notifications to the archive after this
   * many milliseconds since `processing_completed_at`. Default: 7 days.
   */
  archiveAfterMs: number;
  /**
   * Permanently delete archived records after this many milliseconds since
   * `archived_at`. 0 = never delete. Default: 90 days.
   */
  deleteAfterMs: number;
  /** Max rows to process per cycle (prevents long-running transactions). Default: 500. */
  batchSize: number;
}

const DEFAULTS: ArchiveConfig = {
  enabled: true,
  intervalMs: 6 * 60 * 60 * 1000,      // 6 h
  archiveAfterMs: 7 * 24 * 60 * 60 * 1000,   // 7 days
  deleteAfterMs: 90 * 24 * 60 * 60 * 1000,  // 90 days
  batchSize: 500,
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function loadArchiveConfig(): ArchiveConfig {
  return {
    enabled: process.env.ARCHIVE_ENABLED?.trim() !== 'false',
    intervalMs: parseIntEnv('ARCHIVE_INTERVAL_MS', DEFAULTS.intervalMs),
    archiveAfterMs: parseIntEnv('ARCHIVE_AFTER_MS', DEFAULTS.archiveAfterMs),
    deleteAfterMs: parseIntEnv('ARCHIVE_DELETE_AFTER_MS', DEFAULTS.deleteAfterMs),
    batchSize: parseIntEnv('ARCHIVE_BATCH_SIZE', DEFAULTS.batchSize),
  };
}
