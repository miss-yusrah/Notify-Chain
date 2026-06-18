import dotenv from 'dotenv';
import { startEventsServer } from './api/events-server';
import { EventSubscriber } from './services/event-subscriber';
import logger from './utils/logger';
import { loadConfig, ConfigError } from './config';

dotenv.config();

async function main() {
  const config = loadConfig();
  const eventsServer = startEventsServer({
    port: config.eventsApiPort,
    corsOrigin: config.eventsApiCorsOrigin,
    stellarRpcUrl: config.stellarRpcUrl,
    discordWebhookUrl: config.discord?.webhookUrl,
  });
  const subscriber = new EventSubscriber(config);
  await subscriber.start();

  const shutdown = async () => {
    await subscriber.stop();
    eventsServer.close();
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
