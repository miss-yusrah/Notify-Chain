import dotenv from 'dotenv';
import { startEventsServer } from './api/events-server';
import { EventSubscriber } from './services/event-subscriber';
import { NotificationScheduler } from './services/notification-scheduler';
import { ScheduledNotificationRepository } from './services/scheduled-notification-repository';
import { NotificationAPI } from './services/notification-api';
import { initializeDatabase } from './database/database';
import { DiscordNotificationService } from './services/discord-notification';
import logger from './utils/logger';
import { loadConfig, ConfigError } from './config';

dotenv.config();

async function main() {
  const config = loadConfig();

  // Initialize database for scheduled notifications
  let scheduler: NotificationScheduler | null = null;
  let notificationAPI: NotificationAPI | null = null;

  if (config.scheduler?.enabled) {
    try {
      logger.info('Initializing database for scheduled notifications');
      const db = await initializeDatabase(config.databasePath);

      const repository = new ScheduledNotificationRepository(db);
      notificationAPI = new NotificationAPI(repository);

      // Initialize scheduler with Discord service if available
      let discordService: DiscordNotificationService | null = null;
      if (config.discord) {
        discordService = new DiscordNotificationService(config.discord);
      }

      scheduler = new NotificationScheduler(repository, config.scheduler, discordService);
      await scheduler.start();

      logger.info('Notification scheduler started successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler', { error });
      throw error;
    }
  }

  // Start events server and subscriber
  const eventsServer = startEventsServer({
    port: config.eventsApiPort,
    corsOrigin: config.eventsApiCorsOrigin,
    stellarRpcUrl: config.stellarRpcUrl,
    discordWebhookUrl: config.discord?.webhookUrl,
    notificationAPI, // Pass API to events server for scheduling endpoints
  });

  const subscriber = new EventSubscriber(config);
  await subscriber.start();

  const shutdown = async () => {
    logger.info('Shutting down services...');

    if (scheduler) {
      await scheduler.stop();
    }

    await subscriber.stop();
    eventsServer.close();

    logger.info('All services stopped successfully');
    process.exit(0);
  };

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down');
    await shutdown();
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    await shutdown();
  });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    logger.error('Configuration error', { error: err.message });
  } else {
    logger.error('Error starting service', { error: err });
  }
  process.exit(1);
});
