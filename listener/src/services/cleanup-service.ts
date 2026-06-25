import { Database } from '../database/database';
import logger from '../utils/logger';
import { EventRegistry } from '../store/event-registry';

export interface CleanupConfig {
  /** How often to run cleanup (ms). Default: 1 hour. */
  intervalMs: number;
  /** Retain completed/failed notifications for this long (ms). Default: 7 days. */
  notificationRetentionMs: number;
  /** Retain rate-limit audit events for this long (ms). Default: 24 hours. */
  rateLimitEventRetentionMs: number;
}

const DEFAULTS: CleanupConfig = {
  intervalMs: 60 * 60 * 1000,
  notificationRetentionMs: 7 * 24 * 60 * 60 * 1000,
  rateLimitEventRetentionMs: 24 * 60 * 60 * 1000,
};

export class CleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly config: CleanupConfig;

  constructor(
    private readonly db: Database,
    private readonly registry: EventRegistry,
    config: Partial<CleanupConfig> = {},
  ) {
    this.config = { ...DEFAULTS, ...config };
  }

  start(): void {
    if (this.timer) return;
    this.registry.startCleanup(this.config.intervalMs);
    this.timer = setInterval(() => void this.runDbCleanup(), this.config.intervalMs);
    logger.info('CleanupService started', this.config as unknown as Record<string, unknown>);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.registry.stopCleanup();
    logger.info('CleanupService stopped');
  }

  async runDbCleanup(): Promise<{ notifications: number; executionLogs: number; rateLimitEvents: number }> {
    const notificationCutoff = new Date(Date.now() - this.config.notificationRetentionMs).toISOString();
    const rateLimitCutoff = new Date(Date.now() - this.config.rateLimitEventRetentionMs).toISOString();

    const [notifResult, rateLimitResult] = await Promise.all([
      this.db.run(
        `DELETE FROM scheduled_notifications
         WHERE status IN ('COMPLETED','FAILED','CANCELLED')
           AND processing_completed_at < ?`,
        [notificationCutoff],
      ),
      this.db.run(
        `DELETE FROM rate_limit_events WHERE timestamp < ?`,
        [rateLimitCutoff],
      ),
    ]);

    // execution_log rows are cascade-deleted with their parent; count separately for metrics
    const logResult = await this.db.get<{ count: number }>(
      `SELECT changes() as count`,
    );

    const result = {
      notifications: notifResult.changes,
      executionLogs: 0, // removed via ON DELETE CASCADE
      rateLimitEvents: rateLimitResult.changes,
    };

    logger.info('DB cleanup completed', result);
    return result;
  }
}
