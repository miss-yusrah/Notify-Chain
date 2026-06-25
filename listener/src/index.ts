import dotenv from 'dotenv';
import { startEventsServer } from './api/events-server';
import { EventSubscriber } from './services/event-subscriber';
import { NotificationScheduler } from './services/notification-scheduler';
import { RetryScheduler } from './services/retry-scheduler';
import { ScheduledNotificationRepository } from './services/scheduled-notification-repository';
import { NotificationTemplateRepository } from './services/notification-template-repository';
import { NotificationTemplateService } from './services/notification-template-service';
import { TemplateAuditTrail } from './services/template-audit-trail';
import { getTemplateCache } from './services/notification-template-cache';
import { NotificationAPI } from './services/notification-api';
import { CleanupService } from './services/cleanup-service';
import { ArchiveService } from './services/archive-service';
import { ArchiveStore } from './services/archive-store';
import { loadArchiveConfig } from './services/archive-config';
import { initializeDatabase } from './database/database';
import { DiscordNotificationService } from './services/discord-notification';
import { eventRegistry } from './store/event-registry';
import logger from './utils/logger';
import { loadConfig, ConfigError } from './config';

dotenv.config();

async function main() {
  const config = loadConfig();

  // Initialize database for templates, scheduler, and rate limiting
  let scheduler: NotificationScheduler | null = null;
  let retryScheduler: RetryScheduler | null = null;
  let notificationAPI: NotificationAPI | null = null;
  let templateService: NotificationTemplateService | null = null;
  let cleanupService: CleanupService | null = null;
  let archiveService: ArchiveService | null = null;
  let archiveStore: ArchiveStore | null = null;

  try {
    logger.info('Initializing database');
    const db = await initializeDatabase(config.databasePath);

    // Rebuild registry with configured event TTL
    if (config.cleanup) {
      eventRegistry.setTtlMs(config.cleanup.eventRetentionMs);
    }

    cleanupService = new CleanupService(db, eventRegistry, config.cleanup);
    cleanupService.start();

    // Archive service: moves old notifications to the archive table.
    const archiveCfg = loadArchiveConfig();
    archiveStore = new ArchiveStore(db);
    archiveService = new ArchiveService(db, archiveCfg);
    await archiveService.initialize();
    if (archiveCfg.enabled) {
      archiveService.start();
      logger.info('ArchiveService started');
    }

    const templateRepository = new NotificationTemplateRepository(
      db,
      new TemplateAuditTrail(db),
      getTemplateCache(),
    );
    templateService = new NotificationTemplateService(templateRepository);

    if (config.scheduler?.enabled) {
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

      if (config.retryScheduler?.enabled) {
        retryScheduler = new RetryScheduler(repository, config.retryScheduler, discordService);
        await retryScheduler.start();
        logger.info('Retry scheduler started successfully');
      }
    }
  } catch (error) {
    logger.error('Failed to initialize database or scheduler', { error });
    throw error;
  }

  // Start events server and subscriber
  const eventsServer = startEventsServer({
    port: config.eventsApiPort,
    corsOrigin: config.eventsApiCorsOrigin,
    stellarRpcUrl: config.stellarRpcUrl,
    discordWebhookUrl: config.discord?.webhookUrl,
    notificationAPI,
    templateService,
    rateLimit: config.rateLimit,
    archiveStore,
    archiveService,
  });

  const subscriber = new EventSubscriber(config);
  await subscriber.start();

  const shutdown = async () => {
    logger.info('Shutting down services...');

    if (cleanupService) {
      await cleanupService.stop();
    }

    if (archiveService) {
      archiveService.stop();
    }

    if (scheduler) {
      await scheduler.stop();
    }

    if (retryScheduler) {
      await retryScheduler.stop();
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
