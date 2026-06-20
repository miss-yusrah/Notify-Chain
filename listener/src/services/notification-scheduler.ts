import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { generateRequestId } from '../utils/request-id';
import { ScheduledNotificationRepository } from './scheduled-notification-repository';
import { SchedulerConfig, NotificationStatus, ScheduledNotification } from '../types/scheduled-notification';
import { DiscordNotificationService } from './discord-notification';

/**
 * Background scheduler that processes scheduled notifications
 * Features:
 * - Distributed lock to prevent race conditions
 * - Automatic recovery of stale locks
 * - Retry logic with exponential backoff
 * - Catch-up for missed schedules after downtime
 */
export class NotificationScheduler {
  private repository: ScheduledNotificationRepository;
  private discordService: DiscordNotificationService | null;
  private config: SchedulerConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private processorId: string;

  constructor(
    repository: ScheduledNotificationRepository,
    config: SchedulerConfig,
    discordService?: DiscordNotificationService | null
  ) {
    this.repository = repository;
    this.config = config;
    this.discordService = discordService ?? null;
    this.processorId = config.processorId || uuidv4();
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Scheduler is disabled in configuration');
      return;
    }

    this.isRunning = true;
    logger.info('Starting notification scheduler', {
      processorId: this.processorId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
    });

    // Recover stale locks on startup
    await this.repository.recoverStaleLocks();

    // Start processing loop
    this.scheduleNextPoll();
  }

  /**
   * Stop the scheduler gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping notification scheduler', { processorId: this.processorId });
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Schedule next poll cycle
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      await this.processPendingNotifications();
      this.scheduleNextPoll();
    }, this.config.pollIntervalMs);
  }

  /**
   * Main processing loop
   */
  private async processPendingNotifications(): Promise<void> {
    const requestId = generateRequestId();
    const batchStart = Date.now();

    try {
      // Recover any stale locks from crashed processors
      await this.repository.recoverStaleLocks(requestId);

      // Fetch and lock pending notifications
      const notifications = await this.repository.fetchAndLockPendingNotifications(
        this.processorId,
        this.config.lockTimeoutMs,
        this.config.batchSize,
        requestId
      );

      if (notifications.length === 0) {
        logger.debug('Scheduler poll cycle complete', {
          requestId,
          processorId: this.processorId,
          count: 0,
          durationMs: Date.now() - batchStart,
        });
        return;
      }

      logger.info('Processing batch of scheduled notifications', {
        requestId,
        count: notifications.length,
        processorId: this.processorId,
      });

      // Process each notification
      for (const notification of notifications) {
        await this.processNotification(notification, requestId);
      }

      logger.info('Scheduler batch complete', {
        requestId,
        processorId: this.processorId,
        count: notifications.length,
        durationMs: Date.now() - batchStart,
      });
    } catch (error) {
      logger.error('Error in scheduler processing loop', {
        requestId,
        error,
        processorId: this.processorId,
        durationMs: Date.now() - batchStart,
      });
    }
  }

  /**
   * Process a single notification
   */
  private async processNotification(
    notification: ScheduledNotification,
    requestId: string
  ): Promise<void> {
    const startTime = Date.now();
    const executionAttempt = notification.retryCount + 1;

    try {
      logger.info('Processing scheduled notification', {
        requestId,
        id: notification.id,
        type: notification.notificationType,
        executeAt: notification.executeAt,
        attempt: executionAttempt,
      });

      // Check if notification is within timing buffer
      const now = new Date();
      const timeDiff = now.getTime() - notification.executeAt.getTime();

      if (timeDiff < -this.config.timingBufferMs) {
        // Notification is not yet due (clock skew or early fetch)
        logger.warn('Notification not yet due, releasing lock', {
          requestId,
          id: notification.id,
          executeAt: notification.executeAt,
          now,
        });
        await this.repository.markAsFailedOrRetry(
          notification.id!,
          new Error('Not yet due for execution'),
          notification.retryCount,
          notification.maxRetries
        );
        return;
      }

      // Execute notification based on type
      const success = await this.executeNotification(notification, requestId);

      const durationMs = Date.now() - startTime;

      if (success) {
        await this.repository.markAsCompleted(notification.id!, requestId);
        await this.repository.logExecution({
          scheduledNotificationId: notification.id!,
          executionAttempt,
          executionTime: new Date(),
          status: 'SUCCESS',
          durationMs,
        });

        logger.info('Notification delivered successfully', {
          requestId,
          id: notification.id,
          type: notification.notificationType,
          durationMs,
        });
      } else {
        throw new Error('Notification delivery returned false');
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('Failed to process notification', {
        requestId,
        id: notification.id,
        error,
        attempt: executionAttempt,
        durationMs,
      });

      await this.repository.markAsFailedOrRetry(
        notification.id!,
        error as Error,
        notification.retryCount,
        notification.maxRetries
      );

      await this.repository.logExecution({
        scheduledNotificationId: notification.id!,
        executionAttempt,
        executionTime: new Date(),
        status: notification.retryCount >= notification.maxRetries ? 'FAILED' : 'RETRY',
        errorMessage: (error as Error).message,
        durationMs,
      });
    }
  }

  /**
   * Execute notification delivery based on type
   */
  private async executeNotification(
    notification: ScheduledNotification,
    requestId: string
  ): Promise<boolean> {
    const payload = JSON.parse(notification.payload);

    switch (notification.notificationType) {
      case 'discord':
        if (!this.discordService) {
          throw new Error('Discord service not configured');
        }
        return await this.discordService.sendEventNotification(
          payload.event,
          payload.contractConfig,
          `scheduler-${notification.id}-${requestId}`
        );

      case 'webhook':
        // Implement webhook delivery
        throw new Error('Webhook delivery not yet implemented');

      case 'email':
        // Implement email delivery
        throw new Error('Email delivery not yet implemented');

      case 'sms':
        // Implement SMS delivery
        throw new Error('SMS delivery not yet implemented');

      default:
        throw new Error(`Unsupported notification type: ${notification.notificationType}`);
    }
  }

  /**
   * Get scheduler statistics
   */
  async getStats() {
    return await this.repository.getStats();
  }
}
