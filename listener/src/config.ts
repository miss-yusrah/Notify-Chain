import { Config, ContractConfig, DiscordConfig } from './types';

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

  return { webhookUrl, webhookId };
}

export function loadConfig(): Config {
  const discord = loadDiscordConfig();
  const rawContractAddresses = parseJsonEnv<unknown>('CONTRACT_ADDRESSES', '[]');

  return {
    stellarNetwork: trimEnv('STELLAR_NETWORK') || 'testnet',
    stellarRpcUrl:
      trimEnv('STELLAR_RPC_URL') || 'https://soroban-testnet.stellar.org:443',
    contractAddresses: validateContractAddresses(rawContractAddresses),
    pollIntervalMs: parseIntegerEnv('POLL_INTERVAL_MS', '30000'),
    maxReconnectAttempts: parseIntegerEnv('MAX_RECONNECT_ATTEMPTS', '5'),
    reconnectDelayMs: parseIntegerEnv('RECONNECT_DELAY_MS', '5000'),
    eventsApiPort: parseIntegerEnv('EVENTS_API_PORT', '8787'),
    eventsApiCorsOrigin: trimEnv('EVENTS_API_CORS_ORIGIN') || 'http://localhost:5173',
    discord,
    retryQueue: {
      baseDelayMs: parseIntegerEnv('RETRY_BASE_DELAY_MS', '5000'),
      maxRetries: parseIntegerEnv('RETRY_MAX_RETRIES', '5'),
    },
  };
}
