import dotenv from 'dotenv';
import { Config, DiscordConfig } from './types';
import { startEventsServer } from './api/events-server';
import { EventSubscriber } from './services/event-subscriber';
import logger from './utils/logger';

dotenv.config();

function loadDiscordConfig(): DiscordConfig | undefined {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const webhookId = process.env.DISCORD_WEBHOOK_ID;
  if (!webhookUrl || !webhookId) {
    return undefined;
  }
  return { webhookUrl, webhookId };
}

function loadConfig(): Config {
  const discord = loadDiscordConfig();
  return {
    stellarNetwork: process.env.STELLAR_NETWORK || 'testnet',
    stellarRpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org:443',
    contractAddresses: JSON.parse(process.env.CONTRACT_ADDRESSES || '[]'),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000'),
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '5'),
    reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000'),
    eventsApiPort: parseInt(process.env.EVENTS_API_PORT || '8787'),
    eventsApiCorsOrigin: process.env.EVENTS_API_CORS_ORIGIN || 'http://localhost:5173',
    discord,
  };
}

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
  logger.error('Error starting service', { error: err });
  process.exit(1);
});
