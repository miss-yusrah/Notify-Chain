import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { generateRequestId } from '../utils/request-id';
import { ScheduledNotificationRepository } from './scheduled-notification-repository';
import { ScheduledNotification, NotificationStatus } from '../types/scheduled-notification';
import { DiscordNotificationService } from './discord-notification';

export interface RetrySchedulerConfig {
  /** Whether the scheduler is enabled. */
  enabled: boolean;
  /** How often to poll for due retries (ms). */
  pollIntervalMs: number;
  /** How long to hold a distributed lock before it is considered stale (ms). */
  lockTimeoutMs: number;
  /** Unique identifier for this scheduler instance (used in distributed locking). */
  processorId?: string;
  /** Maximum notifications to process per poll cycle. */
  batchSize: number;
  /** Backoff base delay (ms). Delay = base * multiplier^attempt */
  baseDelayMs: number;
  /** Backoff multiplier. Default: 2. */
  multiplier: number;
  /** Maximum delay cap (ms). Default: 1 hour. */
  maxDelayMs: number;
  /** Add ±25 % random jitter to prevent thundering herd. Default: true. */
  jitter: boolean;
}

export const RETRY_SCHEDULER_DEFAULTS: RetrySchedulerConfig = {
  enabled: true,
  pollIntervalMs: 15_000,
  lockTimeoutMs: 60_000,
  batchSize: 10,
  baseDelayMs: 5_000,
  multiplier: 2,
  maxDelayMs: 60 * 60 * 1_000,
  jitter: true,
};

/**
 * Calculates exponential backoff delay with optional jitter.
 *
 * Formula: delay = min(base * multiplier^attempt, maxDelayMs)
 * Jitter:  delay *= (0.75 + Math.random() * 0.5)  → ±25 %
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  multiplier: number,
  maxDelayMs: number,
  jitter: boolean
): number {
  const raw = Math.min(baseDelayMs * Math.pow(multiplier, attempt), maxDelayMs);
  return jitter ? raw * (0.75 + Math.random() * 0.5) : raw;
}

/**
 * DB-backed retry scheduler.
 *
 * On each poll cycle it:
 *  1. Atomically claims PENDING notifications with retry_count > 0 that are due
 *     (next_retry_at ≤ now) using the repository's pessimistic lock.
 *  2. Re-executes the notification delivery.
 *  3. On success → marks COMPLETED.
 *  4. On failure  → if retries remain, computes next backoff delay, writes
 *     next_retry_at, and resets status to PENDING.  Otherwise marks FAILED.
 *
 * The distributed lock (processor_id + lock_expires_at) prevents two concurrent
 * scheduler instances from retrying the same notification.
 */
export class RetryScheduler {
  private readonly config: RetrySchedulerConfig;
  private readonly processorId: string;
  private repository: ScheduledNotificationRepository;
  private discordService: DiscordNotificationService | null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    repository: ScheduledNotificationRepository,
    config: Partial<RetrySchedulerConfig> = {},
    discordService?: DiscordNotificationService | null
  ) {
    this.config = { ...RETRY_SCHEDULER_DEFAULTS, ...config };
    this.processorId = this.config.processorId ?? `retry-${uuidv4()}`;
    this.repository = repository;
    this.discordService = discordService ?? null;
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('RetryScheduler already running', { processorId: this.processorId });
      return;
    }
    if (!this.config.enabled) {
      logger.info('RetryScheduler is disabled');
      return;
    }

    this.running = true;
    logger.info('RetryScheduler started', {
      processorId: this.processorId,
      pollIntervalMs: this.config.pollIntervalMs,
      baseDelayMs: this.config.baseDelayMs,
      multiplier: this.config.multiplier,
      maxDelayMs: this.config.maxDelayMs,
      jitter: this.config.jitter,
    });

    await this.repository.recoverStaleLocks();
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('RetryScheduler stopped', { processorId: this.processorId });
  }

  /** Exposed for testing. */
  async runOnce(): Promise<void> {
    await this.processDueRetries();
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.processDueRetries();
      this.scheduleNextPoll();
    }, this.config.pollIntervalMs);
  }

  private async processDueRetries(): Promise<void> {
    const requestId = generateRequestId();

    try {
      await this.repository.recoverStaleLocks(requestId);

      const notifications = await this.repository.fetchDueRetries(
        this.processorId,
        this.config.lockTimeoutMs,
        this.config.batchSize,
        requestId
      );

      if (notifications.length === 0) return;

      logger.info('RetryScheduler processing batch', {
        requestId,
        processorId: this.processorId,
        count: notifications.length,
      });

      for (const notification of notifications) {
        await this.processRetry(notification, requestId);
      }
    } catch (err) {
      logger.error('RetryScheduler poll error', { requestId, error: err });
    }
  }

  private async processRetry(
    notification: ScheduledNotification,
    requestId: string
  ): Promise<void> {
    const attempt = notification.retryCount; // already incremented on prior failure
    const startMs = Date.now();

    logger.info('Retrying notification', {
      requestId,
      id: notification.id,
      type: notification.notificationType,
      attempt,
      maxRetries: notification.maxRetries,
    });

    try {
      const success = await this.deliver(notification, requestId);
      const durationMs = Date.now() - startMs;

      if (success) {
        await this.repository.markAsCompleted(notification.id!, requestId);
        await this.repository.logExecution({
          scheduledNotificationId: notification.id!,
          executionAttempt: attempt,
          executionTime: new Date(),
          status: 'SUCCESS',
          durationMs,
        });
        logger.info('Retry succeeded', { requestId, id: notification.id, attempt });
        return;
      }

      throw new Error('Delivery returned false');
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err as Error;
      const isFinalAttempt = attempt >= notification.maxRetries;

      const nextRetryAt = isFinalAttempt
        ? undefined
        : new Date(
            Date.now() +
              calculateBackoffDelay(
                attempt,
                this.config.baseDelayMs,
                this.config.multiplier,
                this.config.maxDelayMs,
                this.config.jitter
              )
          );

      await this.repository.markAsFailedOrRetry(
        notification.id!,
        error,
        attempt,
        notification.maxRetries,
        nextRetryAt
      );

      await this.repository.logExecution({
        scheduledNotificationId: notification.id!,
        executionAttempt: attempt,
        executionTime: new Date(),
        status: isFinalAttempt ? 'FAILED' : 'RETRY',
        errorMessage: error.message,
        durationMs,
      });

      if (isFinalAttempt) {
        logger.error('Notification permanently failed after max retries', {
          requestId,
          id: notification.id,
          totalAttempts: attempt,
        });
      } else {
        logger.warn('Retry failed, scheduling next attempt', {
          requestId,
          id: notification.id,
          attempt,
          nextRetryAt: nextRetryAt?.toISOString(),
        });
      }
    }
  }

  private async deliver(
    notification: ScheduledNotification,
    requestId: string
  ): Promise<boolean> {
    const payload = JSON.parse(notification.payload);

    switch (notification.notificationType) {
      case 'discord':
        if (!this.discordService) throw new Error('Discord service not configured');
        return this.discordService.sendEventNotification(
          payload.event,
          payload.contractConfig,
          `retry-${notification.id}-${requestId}`
        );

      default:
        throw new Error(`Unsupported notification type: ${notification.notificationType}`);
    }
  }
}
