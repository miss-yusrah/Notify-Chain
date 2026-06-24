import { Database } from '../database/database';
import { ScheduledNotificationRepository } from '../services/scheduled-notification-repository';
import { NotificationScheduler } from '../services/notification-scheduler';
import { NotificationAPI } from '../services/notification-api';
import {
  NotificationType,
  NotificationStatus,
  CreateScheduledNotificationInput,
} from '../types/scheduled-notification';
import * as fs from 'fs';
import * as path from 'path';

describe('NotificationScheduler', () => {
  let db: Database;
  let repository: ScheduledNotificationRepository;
  let scheduler: NotificationScheduler;
  let api: NotificationAPI;

  const testDbPath = './data/test-notifications.db';

  beforeAll(async () => {
    // Clean up test database if it exists
    const dbDir = path.dirname(testDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize test database
    db = new Database(testDbPath);
    await db.initialize();
    repository = new ScheduledNotificationRepository(db);
    api = new NotificationAPI(repository);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  beforeEach(async () => {
    // Clear tables before each test
    await db.run('DELETE FROM notification_execution_log');
    await db.run('DELETE FROM scheduled_notifications');
  });

  describe('ScheduledNotificationRepository', () => {
    test('should create a scheduled notification', async () => {
      const input: CreateScheduledNotificationInput = {
        payload: { message: 'Test notification' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() + 60000),
        maxRetries: 3,
        priority: 5,
      };

      const id = await repository.create(input);
      expect(id).toBeGreaterThan(0);

      const notification = await repository.getById(id);
      expect(notification).toBeDefined();
      expect(notification!.status).toBe(NotificationStatus.PENDING);
      expect(notification!.retryCount).toBe(0);
    });

    test('should fetch and lock pending notifications', async () => {
      const executeAt = new Date(Date.now() - 1000); // Past time

      await repository.create({
        payload: { message: 'Test 1' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt,
      });

      await repository.create({
        payload: { message: 'Test 2' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt,
      });

      const processorId = 'test-processor-1';
      const notifications = await repository.fetchAndLockPendingNotifications(
        processorId,
        30000,
        10
      );

      expect(notifications.length).toBe(2);
      expect(notifications[0].status).toBe(NotificationStatus.PROCESSING);
      expect(notifications[0].processorId).toBe(processorId);
      expect(notifications[0].lockExpiresAt).toBeDefined();
    });

    test('should prevent race conditions with distributed locking', async () => {
      const executeAt = new Date(Date.now() - 1000);

      await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt,
      });

      const processor1 = await repository.fetchAndLockPendingNotifications(
        'processor-1',
        30000,
        10
      );
      const processor2 = await repository.fetchAndLockPendingNotifications(
        'processor-2',
        30000,
        10
      );

      expect(processor1.length).toBe(1);
      expect(processor2.length).toBe(0); // Should not pick up locked notification
    });

    test('should recover stale locks', async () => {
      const executeAt = new Date(Date.now() - 1000);

      const id = await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt,
      });

      // Lock the notification
      await repository.fetchAndLockPendingNotifications('processor-1', 30000, 10);

      // Manually expire the lock
      const pastLock = new Date(Date.now() - 1000);
      await db.run('UPDATE scheduled_notifications SET lock_expires_at = ? WHERE id = ?', [
        pastLock.toISOString(),
        id,
      ]);

      const recovered = await repository.recoverStaleLocks();
      expect(recovered).toBe(1);

      const notification = await repository.getById(id);
      expect(notification!.status).toBe(NotificationStatus.PENDING);
      expect(notification!.processorId).toBeNull();
    });

    test('should mark notification as completed', async () => {
      const id = await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() - 1000),
      });

      await repository.markAsCompleted(id);

      const notification = await repository.getById(id);
      expect(notification!.status).toBe(NotificationStatus.COMPLETED);
      expect(notification!.processingCompletedAt).toBeDefined();
    });

    test('should retry failed notification', async () => {
      const id = await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() - 1000),
        maxRetries: 3,
      });

      const error = new Error('Test error');
      await repository.markAsFailedOrRetry(id, error, 0, 3);

      const notification = await repository.getById(id);
      expect(notification!.status).toBe(NotificationStatus.PENDING); // Should retry
      expect(notification!.retryCount).toBe(1);
      expect(notification!.lastError).toBe('Test error');
    });

    test('should mark as failed after max retries', async () => {
      const id = await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() - 1000),
        maxRetries: 3,
      });

      const error = new Error('Test error');
      await repository.markAsFailedOrRetry(id, error, 3, 3);

      const notification = await repository.getById(id);
      expect(notification!.status).toBe(NotificationStatus.FAILED);
      expect(notification!.retryCount).toBe(4);
    });

    test('should cancel pending notification', async () => {
      const id = await repository.create({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() + 60000),
      });

      const cancelled = await repository.cancel(id);
      expect(cancelled).toBe(true);

      const notification = await repository.getById(id);
      expect(notification!.status).toBe(NotificationStatus.CANCELLED);
    });

    test('should get statistics', async () => {
      await repository.create({
        payload: { message: 'Test 1' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() + 60000),
      });

      await repository.create({
        payload: { message: 'Test 2' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() - 60000), // Overdue
      });

      const stats = await repository.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.overdue).toBe(1);
    });
  });

  describe('NotificationAPI', () => {
    test('should schedule notification via API', async () => {
      const executeAt = new Date(Date.now() + 60000);

      const id = await api.scheduleNotification({
        payload: { message: 'API test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt,
      });

      expect(id).toBeGreaterThan(0);

      const notification = await api.getNotification(id);
      expect(notification).toBeDefined();
      expect(notification!.status).toBe(NotificationStatus.PENDING);
    });

    test('should reject expired execution time', async () => {
      const pastDate = new Date(Date.now() - 60000);

      await expect(
        api.scheduleNotification({
          payload: { message: 'Test' },
          notificationType: NotificationType.DISCORD,
          targetRecipient: 'test-webhook',
          executeAt: pastDate,
        })
      ).rejects.toThrow('executeAt must be a future timestamp — the provided date has already expired');
    });

    test('should reject execution time equal to now', async () => {
      // A timestamp at (or just before) the current moment is already expired
      const now = new Date();

      await expect(
        api.scheduleNotification({
          payload: { message: 'Test' },
          notificationType: NotificationType.DISCORD,
          targetRecipient: 'test-webhook',
          executeAt: now,
        })
      ).rejects.toThrow('executeAt must be a future timestamp');
    });

    test('should reject invalid date object', async () => {
      await expect(
        api.scheduleNotification({
          payload: { message: 'Test' },
          notificationType: NotificationType.DISCORD,
          targetRecipient: 'test-webhook',
          executeAt: new Date('not-a-date'),
        })
      ).rejects.toThrow('executeAt must be a valid date');
    });

    test('should accept execution time 1 second in the future', async () => {
      const nearFuture = new Date(Date.now() + 1000);

      const id = await api.scheduleNotification({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: nearFuture,
      });

      expect(id).toBeGreaterThan(0);
    });

    test('should schedule Discord notification', async () => {
      const executeAt = new Date(Date.now() + 60000);

      const id = await api.scheduleDiscordNotification(
        'https://discord.com/webhook/test',
        { content: 'Hello World' },
        executeAt,
        { priority: 1, maxRetries: 5 }
      );

      expect(id).toBeGreaterThan(0);

      const notification = await api.getNotification(id);
      expect(notification!.priority).toBe(1);
      expect(notification!.maxRetries).toBe(5);
    });

    test('should get statistics via API', async () => {
      await api.scheduleNotification({
        payload: { message: 'Test' },
        notificationType: NotificationType.DISCORD,
        targetRecipient: 'test-webhook',
        executeAt: new Date(Date.now() + 60000),
      });

      const stats = await api.getStatistics();
      expect(stats.pending).toBeGreaterThan(0);
    });
  });
});
