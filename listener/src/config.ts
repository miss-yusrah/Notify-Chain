import { Config, ContractConfig, DiscordConfig, WebhookSecret, AppCleanupConfig, EventQueueConfig } from './types';
import { Config, ContractConfig, DiscordConfig, WebhookSecret, AppCleanupConfig, RetrySchedulerOptions } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function trimEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined ? undefined : value.trim();
}

function parseIntegerEnv(name: string, defaultValue: string): number {
  const rawValue = trimEnv(name);
  const value = rawValue !== undefined ? rawValue : defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`${name} must be a valid integer, got "${value}"`);
  }
  return parsed;
}

function parseJsonEnv<T>(name: string, defaultValue: string): T {
  const rawValue = trimEnv(name) ?? defaultValue;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    throw new ConfigError(`${name} must be valid JSON. Received: ${rawValue}`);
  }
}

function validateContractAddresses(value: unknown): ContractConfig[] {
  if (!Array.isArray(value)) {
    throw new ConfigError('CONTRACT_ADDRESSES must be a JSON array of contract objects.');
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new ConfigError(`CONTRACT_ADDRESSES[${index}] must be an object with address and events.`);
    }

    const address = (item as any).address;
    const events = (item as any).events;

    if (typeof address !== 'string' || !address.trim()) {
      throw new ConfigError(`CONTRACT_ADDRESSES[${index}].address must be a non-empty string.`);
    }

    if (!Array.isArray(events) || events.some((event) => typeof event !== 'string')) {
      throw new ConfigError(
        `CONTRACT_ADDRESSES[${index}].events must be an array of string event names.`
      );
    }

    return {
      address: address.trim(),
      events: events.map((event) => event.trim()),
    };
  });
}

function loadDiscordConfig(): DiscordConfig | undefined {
  const webhookUrl = trimEnv('DISCORD_WEBHOOK_URL');
  const webhookId = trimEnv('DISCORD_WEBHOOK_ID');

  if (!webhookUrl && !webhookId) {
    return undefined;
  }

  if (!webhookUrl) {
    throw new ConfigError('DISCORD_WEBHOOK_URL is required when DISCORD_WEBHOOK_ID is provided.');
  }

  if (!webhookId) {
    throw new ConfigError('DISCORD_WEBHOOK_ID is required when DISCORD_WEBHOOK_URL is provided.');
  }

  return {
    webhookUrl,
    webhookId,
    deduplicationWindowMs: parseIntegerEnv('NOTIFICATION_DEDUPLICATION_WINDOW_MS', '60000'),
    deduplicationMaxSize: parseIntegerEnv('NOTIFICATION_DEDUPLICATION_MAX_SIZE', '10000'),
  };
}

function validateWebhookSecrets(value: unknown): WebhookSecret[] {
  if (!Array.isArray(value)) {
    throw new ConfigError('WEBHOOK_SECRETS must be a JSON array of secret objects.');
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new ConfigError(
        `WEBHOOK_SECRETS[${index}] must be an object with id and secret.`
      );
    }

    const id = (item as any).id;
    const secret = (item as any).secret;

    if (typeof id !== 'string' || !id.trim()) {
      throw new ConfigError(`WEBHOOK_SECRETS[${index}].id must be a non-empty string.`);
    }

    if (typeof secret !== 'string' || !secret.trim()) {
      throw new ConfigError(`WEBHOOK_SECRETS[${index}].secret must be a non-empty string.`);
    }

    return { id: id.trim(), secret: secret.trim() };
  });
}

function loadCleanupConfig(): AppCleanupConfig {
  return {
    intervalMs: parseIntegerEnv('CLEANUP_INTERVAL_MS', String(60 * 60 * 1000)),
    notificationRetentionMs: parseIntegerEnv('NOTIFICATION_RETENTION_MS', String(7 * 24 * 60 * 60 * 1000)),
    rateLimitEventRetentionMs: parseIntegerEnv('RATE_LIMIT_EVENT_RETENTION_MS', String(24 * 60 * 60 * 1000)),
    eventRetentionMs: parseIntegerEnv('EVENT_RETENTION_MS', String(24 * 60 * 60 * 1000)),
  };
}

function loadRetrySchedulerConfig(): RetrySchedulerOptions {
  return {
    enabled: trimEnv('RETRY_SCHEDULER_ENABLED') !== 'false',
    pollIntervalMs: parseIntegerEnv('RETRY_SCHEDULER_POLL_INTERVAL_MS', '15000'),
    lockTimeoutMs: parseIntegerEnv('RETRY_SCHEDULER_LOCK_TIMEOUT_MS', '60000'),
    processorId: trimEnv('RETRY_SCHEDULER_PROCESSOR_ID'),
    batchSize: parseIntegerEnv('RETRY_SCHEDULER_BATCH_SIZE', '10'),
    baseDelayMs: parseIntegerEnv('RETRY_BASE_DELAY_MS', '5000'),
    multiplier: parseIntegerEnv('RETRY_MULTIPLIER', '2'),
    maxDelayMs: parseIntegerEnv('RETRY_MAX_DELAY_MS', String(60 * 60 * 1000)),
    jitter: trimEnv('RETRY_JITTER') !== 'false',
  };
}

export function loadConfig(): Config {
  const discord = loadDiscordConfig();
  const rawContractAddresses = parseJsonEnv<unknown>('CONTRACT_ADDRESSES', '[]');
  const rawWebhookSecrets = parseJsonEnv<unknown>('WEBHOOK_SECRETS', '[]');
  const clientOverrides = parseJsonEnv<Record<string, { maxRequests: number; windowMs?: number>>(
  const clientOverrides = parseJsonEnv<Record<string, { maxRequests: number; windowMs?: number }>>(
    'RATE_LIMIT_CLIENT_OVERRIDES',
    '{}'
  );

  return {
    stellarNetwork: trimEnv('STELLAR_NETWORK') || 'testnet',
    stellarRpcUrl:
      trimEnv('STELLAR_RPC_URL') || 'https://soroban-testnet.stellar.org:443',
    stellarNetworkPassphrase: trimEnv('STELLAR_NETWORK_PASSPHRASE') || 'Test SDF Network ; September 2015',
    contractAddresses: validateContractAddresses(rawContractAddresses),
    pollIntervalMs: parseIntegerEnv('POLL_INTERVAL_MS', '30000'),
    maxReconnectAttempts: parseIntegerEnv('MAX_RECONNECT_ATTEMPTS', '5'),
    reconnectDelayMs: parseIntegerEnv('RECONNECT_DELAY_MS', '5000'),
    eventsApiPort: parseIntegerEnv('EVENTS_API_PORT', '8787'),
    eventsApiCorsOrigin: trimEnv('EVENTS_API_CORS_ORIGIN') || 'http://localhost:5173',
    databasePath: trimEnv('DATABASE_PATH') || './data/notifications.db',
    discord,
    retryQueue: {
      baseDelayMs: parseIntegerEnv('RETRY_BASE_DELAY_MS', '5000'),
      maxRetries: parseIntegerEnv('RETRY_MAX_RETRIES', '5'),
      multiplier: parseIntegerEnv('RETRY_MULTIPLIER', '2'),
      jitter: trimEnv('RETRY_JITTER') !== 'false',
    },
    eventQueue: {
      maxConcurrency: parseIntegerEnv('EVENT_QUEUE_MAX_CONCURRENCY', '1'),
      maxRetries: parseIntegerEnv('EVENT_QUEUE_MAX_RETRIES', '3'),
      baseDelayMs: parseIntegerEnv('EVENT_QUEUE_BASE_DELAY_MS', '2000'),
      pollIntervalMs: parseIntegerEnv('EVENT_QUEUE_POLL_INTERVAL_MS', '1000'),
    },
    webhookSecrets: validateWebhookSecrets(rawWebhookSecrets),
    scheduler: {
      enabled: trimEnv('SCHEDULER_ENABLED') !== 'false',
      pollIntervalMs: parseIntegerEnv('SCHEDULER_POLL_INTERVAL_MS', '10000'),
      lockTimeoutMs: parseIntegerEnv('SCHEDULER_LOCK_TIMEOUT_MS', '60000'),
      processorId: trimEnv('SCHEDULER_PROCESSOR_ID'),
      batchSize: parseIntegerEnv('SCHEDULER_BATCH_SIZE', '10'),
      timingBufferMs: parseIntegerEnv('SCHEDULER_TIMING_BUFFER_MS', '60000'),
    },
    retryScheduler: loadRetrySchedulerConfig(),
    rateLimit: {
      enabled: trimEnv('RATE_LIMIT_ENABLED') !== 'false',
      windowMs: parseIntegerEnv('RATE_LIMIT_WINDOW_MS', '60000'),
      maxRequests: parseIntegerEnv('RATE_LIMIT_MAX_REQUESTS', '60'),
      clientOverrides,
    },
    cleanup: loadCleanupConfig(),
  };
}

