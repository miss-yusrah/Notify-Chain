import { Database } from '../database/database';
import logger from '../utils/logger';
import {
  ScheduledNotification,
  ScheduledNotificationRow,
  CreateScheduledNotificationInput,
  NotificationStatus,
  NotificationExecutionLog,
} from '../types/scheduled-notification';

/**
 * Repository for scheduled notifications database operations
 * Handles all CRUD operations and queries
 */
export class ScheduledNotificationRepository {
  constructor(private db: Database) {}

  /**
   * Create a new scheduled notification
   */
  async create(input: CreateScheduledNotificationInput, requestId?: string): Promise<number> {
    const sql = `
      INSERT INTO scheduled_notifications (
        payload, notification_type, target_recipient, execute_at,
        max_retries, event_id, contract_address, priority, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      JSON.stringify(input.payload),
      input.notificationType,
      input.targetRecipient,
      input.executeAt.toISOString(),
      input.maxRetries ?? 3,
      input.eventId ?? null,
      input.contractAddress ?? null,
      input.priority ?? 5,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ];

    const result = await this.db.run(sql, params);
    logger.info('Scheduled notification created', {
      requestId,
      id: result.lastID,
      executeAt: input.executeAt,
      type: input.notificationType,
    });

    return result.lastID;
  }

  /**
   * Fetch pending notifications due for execution with distributed locking
   * Uses atomic update to prevent race conditions
   */
  async fetchAndLockPendingNotifications(
    processorId: string,
    lockTimeoutMs: number,
    batchSize: number = 10,
    requestId?: string
  ): Promise<ScheduledNotification[]> {
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + lockTimeoutMs);

    // First, atomically lock available notifications
    const updateSql = `
      UPDATE scheduled_notifications
      SET 
        status = ?,
        processor_id = ?,
        lock_expires_at = ?,
        processing_started_at = ?
      WHERE id IN (
        SELECT id FROM scheduled_notifications
        WHERE status = ?
          AND execute_at <= ?
        ORDER BY priority ASC, execute_at ASC
        LIMIT ?
      )
    `;

    const updateParams = [
      NotificationStatus.PROCESSING,
      processorId,
      lockExpiresAt.toISOString(),
      now.toISOString(),
      NotificationStatus.PENDING,
      now.toISOString(),
      batchSize,
    ];

    const updateResult = await this.db.run(updateSql, updateParams);

    if (updateResult.changes === 0) {
      return [];
    }

    // Fetch the locked notifications
    const selectSql = `
      SELECT * FROM scheduled_notifications
      WHERE processor_id = ? AND status = ? AND lock_expires_at = ?
    `;

    const rows = await this.db.all<ScheduledNotificationRow>(selectSql, [
      processorId,
      NotificationStatus.PROCESSING,
      lockExpiresAt.toISOString(),
    ]);

    logger.info('Fetched and locked pending notifications', {
      requestId,
      count: rows.length,
      processorId,
    });

    return rows.map(this.rowToModel);
  }

  /**
   * Recover stale locks (when a processor crashes)
   * Returns notifications with expired locks back to PENDING
   */
  async recoverStaleLocks(requestId?: string): Promise<number> {
    const now = new Date();

    const sql = `
      UPDATE scheduled_notifications
      SET 
        status = ?,
        processor_id = NULL,
        lock_expires_at = NULL
      WHERE status = ?
        AND lock_expires_at IS NOT NULL
        AND lock_expires_at < ?
    `;

    const result = await this.db.run(sql, [
      NotificationStatus.PENDING,
      NotificationStatus.PROCESSING,
      now.toISOString(),
    ]);

    if (result.changes > 0) {
      logger.warn('Recovered stale locks', { requestId, count: result.changes });
    }

    return result.changes;
  }

  /**
   * Mark notification as completed
   */
  async markAsCompleted(id: number, requestId?: string): Promise<void> {
    const sql = `
      UPDATE scheduled_notifications
      SET 
        status = ?,
        processing_completed_at = ?,
        processor_id = NULL,
        lock_expires_at = NULL
      WHERE id = ?
    `;

    await this.db.run(sql, [
      NotificationStatus.COMPLETED,
      new Date().toISOString(),
      id,
    ]);

    logger.info('Notification marked as completed', { requestId, id });
  }

  /**
   * Mark notification as failed or retry
   */
  async markAsFailedOrRetry(
    id: number,
    error: Error,
    currentRetryCount: number,
    maxRetries: number
  ): Promise<void> {
    const isFailed = currentRetryCount >= maxRetries;
    const newStatus = isFailed ? NotificationStatus.FAILED : NotificationStatus.PENDING;

    const sql = `
      UPDATE scheduled_notifications
      SET 
        status = ?,
        retry_count = ?,
        last_error = ?,
        error_details = ?,
        processing_completed_at = ?,
        processor_id = NULL,
        lock_expires_at = NULL
      WHERE id = ?
    `;

    const errorDetails = JSON.stringify({
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await this.db.run(sql, [
      newStatus,
      currentRetryCount + 1,
      error.message,
      errorDetails,
      isFailed ? new Date().toISOString() : null,
      id,
    ]);

    logger.info('Notification marked for retry or failed', {
      id,
      newStatus,
      retryCount: currentRetryCount + 1,
      maxRetries,
    });
  }

  /**
   * Get notification by ID
   */
  async getById(id: number): Promise<ScheduledNotification | null> {
    const sql = 'SELECT * FROM scheduled_notifications WHERE id = ?';
    const row = await this.db.get<ScheduledNotificationRow>(sql, [id]);
    return row ? this.rowToModel(row) : null;
  }

  /**
   * Cancel a scheduled notification
   */
  async cancel(id: number): Promise<boolean> {
    const sql = `
      UPDATE scheduled_notifications
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `;

    const result = await this.db.run(sql, [
      NotificationStatus.CANCELLED,
      new Date().toISOString(),
      id,
      NotificationStatus.PENDING,
    ]);

    if (result.changes > 0) {
      logger.info('Notification cancelled', { id });
      return true;
    }

    return false;
  }

  /**
   * Log notification execution attempt
   */
  async logExecution(log: NotificationExecutionLog): Promise<void> {
    const sql = `
      INSERT INTO notification_execution_log (
        scheduled_notification_id, execution_attempt, status,
        error_message, response_data, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      log.scheduledNotificationId,
      log.executionAttempt,
      log.status,
      log.errorMessage ?? null,
      log.responseData ?? null,
      log.durationMs ?? null,
    ]);
  }

  /**
   * Get statistics about scheduled notifications
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    overdue: number;
  }> {
    const countBySql = `
      SELECT status, COUNT(*) as count
      FROM scheduled_notifications
      GROUP BY status
    `;

    const overdueSql = `
      SELECT COUNT(*) as count
      FROM scheduled_notifications
      WHERE status = ? AND execute_at < ?
    `;

    const counts = await this.db.all<{ status: string; count: number }>(countBySql);
    const overdueResult = await this.db.get<{ count: number }>(overdueSql, [
      NotificationStatus.PENDING,
      new Date().toISOString(),
    ]);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      overdue: overdueResult?.count ?? 0,
    };

    counts.forEach((row) => {
      const status = row.status.toLowerCase();
      if (status in stats) {
        (stats as any)[status] = row.count;
      }
    });

    return stats;
  }

  /**
   * Convert database row to model
   */
  private rowToModel(row: ScheduledNotificationRow): ScheduledNotification {
    return {
      id: row.id,
      payload: row.payload,
      notificationType: row.notification_type as any,
      targetRecipient: row.target_recipient,
      executeAt: new Date(row.execute_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      status: row.status as NotificationStatus,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      processingStartedAt: row.processing_started_at ? new Date(row.processing_started_at) : null,
      processingCompletedAt: row.processing_completed_at
        ? new Date(row.processing_completed_at)
        : null,
      processorId: row.processor_id,
      lockExpiresAt: row.lock_expires_at ? new Date(row.lock_expires_at) : null,
      lastError: row.last_error,
      errorDetails: row.error_details,
      eventId: row.event_id,
      contractAddress: row.contract_address,
      priority: row.priority,
      metadata: row.metadata,
    };
  }
}
