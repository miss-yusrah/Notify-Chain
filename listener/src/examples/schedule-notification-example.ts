/**
 * Example: How to schedule notifications
 * 
 * This file demonstrates various ways to schedule notifications
 * for future delivery using the NotificationAPI
 */

import { NotificationAPI } from '../services/notification-api';
import { ScheduledNotificationRepository } from '../services/scheduled-notification-repository';
import { initializeDatabase } from '../database/database';
import { NotificationType } from '../types/scheduled-notification';

async function examples() {
  // Initialize database and API
  const db = await initializeDatabase('./data/notifications.db');
  const repository = new ScheduledNotificationRepository(db);
  const api = new NotificationAPI(repository);

  // ====================================================================
  // Example 1: Schedule a Discord notification for 1 hour from now
  // ====================================================================
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);

  const notification1 = await api.scheduleDiscordNotification(
    'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN',
    {
      content: 'This notification was scheduled 1 hour ago!',
      embeds: [
        {
          title: 'Scheduled Notification',
          description: 'Successfully delivered',
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
        },
      ],
    },
    oneHourLater
  );

  console.log(`Scheduled notification ID: ${notification1}`);

  // ====================================================================
  // Example 2: Schedule a high-priority notification for tomorrow 9 AM
  // ====================================================================
  const tomorrow9AM = new Date();
  tomorrow9AM.setDate(tomorrow9AM.getDate() + 1);
  tomorrow9AM.setHours(9, 0, 0, 0);

  const notification2 = await api.scheduleNotification({
    payload: {
      event: {
        id: 'evt_12345',
        contractAddress: 'CXXXXXXX',
        eventName: 'task_completed',
      },
      contractConfig: {
        address: 'CXXXXXXX',
        events: ['task_completed'],
      },
    },
    notificationType: NotificationType.DISCORD,
    targetRecipient: 'https://discord.com/api/webhooks/...',
    executeAt: tomorrow9AM,
    priority: 1, // High priority (1-10, lower = higher)
    maxRetries: 5,
    metadata: {
      source: 'scheduled_task',
      userId: 'user_123',
    },
  });

  console.log(`High-priority notification scheduled for ${tomorrow9AM}`);

  // ====================================================================
  // Example 3: Schedule multiple notifications (batch scheduling)
  // ====================================================================
  const scheduleIds: number[] = [];

  for (let i = 1; i <= 5; i++) {
    const executeAt = new Date(Date.now() + i * 15 * 60 * 1000); // Every 15 minutes

    const id = await api.scheduleDiscordNotification(
      'https://discord.com/api/webhooks/...',
      { content: `Reminder ${i} of 5` },
      executeAt,
      { priority: 5 }
    );

    scheduleIds.push(id);
  }

  console.log(`Scheduled ${scheduleIds.length} reminder notifications`);

  // ====================================================================
  // Example 4: Cancel a scheduled notification
  // ====================================================================
  const cancelled = await api.cancelNotification(notification1);
  console.log(`Notification ${notification1} cancelled: ${cancelled}`);

  // ====================================================================
  // Example 5: Check notification status
  // ====================================================================
  const notification = await api.getNotification(notification2);

  if (notification) {
    console.log('Notification details:', {
      id: notification.id,
      status: notification.status,
      executeAt: notification.executeAt,
      retryCount: notification.retryCount,
      createdAt: notification.createdAt,
    });
  }

  // ====================================================================
  // Example 6: Get scheduler statistics
  // ====================================================================
  const stats = await api.getStatistics();
  console.log('Scheduler statistics:', stats);
  // Output: { pending: 10, processing: 2, completed: 100, failed: 5, overdue: 1 }

  // ====================================================================
  // Example 7: Schedule notification based on blockchain event
  // ====================================================================
  async function scheduleEventNotification(event: any, delayMinutes: number) {
    const executeAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    return await api.scheduleNotification({
      payload: {
        event,
        contractConfig: {
          address: event.contractAddress,
          events: ['*'],
        },
      },
      notificationType: NotificationType.DISCORD,
      targetRecipient: 'https://discord.com/api/webhooks/...',
      executeAt,
      eventId: event.id,
      contractAddress: event.contractAddress,
      metadata: {
        source: 'blockchain_event',
        eventType: event.type,
      },
    });
  }

  // Usage:
  const mockEvent = {
    id: 'evt_98765',
    contractAddress: 'CXXXXXXX',
    type: 'contract',
    eventName: 'payment_received',
  };

  const scheduledEventNotification = await scheduleEventNotification(mockEvent, 30);
  console.log(`Event notification scheduled for 30 minutes: ${scheduledEventNotification}`);

  // ====================================================================
  // Example 8: Schedule with custom retry configuration
  // ====================================================================
  const criticalNotification = await api.scheduleNotification({
    payload: { message: 'Critical system alert' },
    notificationType: NotificationType.DISCORD,
    targetRecipient: 'https://discord.com/api/webhooks/...',
    executeAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    maxRetries: 10, // Retry up to 10 times
    priority: 1, // Highest priority
    metadata: {
      severity: 'critical',
      alertType: 'system',
    },
  });

  console.log(`Critical notification scheduled: ${criticalNotification}`);

  // Clean up
  await db.close();
}

// Run examples
if (require.main === module) {
  examples()
    .then(() => {
      console.log('Examples completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Examples failed:', error);
      process.exit(1);
    });
}

export { examples };
