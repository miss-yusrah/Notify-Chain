import { ConfigError, loadConfig } from './config';

describe('Config validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws a descriptive error when DISCORD_WEBHOOK_ID is set without DISCORD_WEBHOOK_URL', () => {
    process.env.DISCORD_WEBHOOK_ID = '123';

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(
      'DISCORD_WEBHOOK_URL is required when DISCORD_WEBHOOK_ID is provided.'
    );
  });

  it('throws a descriptive error when DISCORD_WEBHOOK_URL is set without DISCORD_WEBHOOK_ID', () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(
      'DISCORD_WEBHOOK_ID is required when DISCORD_WEBHOOK_URL is provided.'
    );
  });

  it('throws a descriptive error for invalid CONTRACT_ADDRESSES JSON', () => {
    process.env.CONTRACT_ADDRESSES = 'not-json';

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow('CONTRACT_ADDRESSES must be valid JSON. Received: not-json');
  });

  it('throws a descriptive error for invalid integer variables', () => {
    process.env.EVENTS_API_PORT = 'eighty';

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow('EVENTS_API_PORT must be a valid integer, got "eighty"');
  });

  it('loads default values when optional environment variables are omitted', () => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.CONTRACT_ADDRESSES;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.MAX_RECONNECT_ATTEMPTS;
    delete process.env.RECONNECT_DELAY_MS;
    delete process.env.EVENTS_API_PORT;
    delete process.env.EVENTS_API_CORS_ORIGIN;
    delete process.env.RETRY_BASE_DELAY_MS;
    delete process.env.RETRY_MAX_RETRIES;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_ID;
    delete process.env.NOTIFICATION_DEDUPLICATION_WINDOW_MS;
    delete process.env.NOTIFICATION_DEDUPLICATION_MAX_SIZE;

    const config = loadConfig();

    expect(config).toMatchObject({
      stellarNetwork: 'testnet',
      stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
      contractAddresses: [],
      pollIntervalMs: 30000,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 5000,
      eventsApiPort: 8787,
      eventsApiCorsOrigin: 'http://localhost:5173',
      retryQueue: {
        baseDelayMs: 5000,
        maxRetries: 5,
      },
    });
  });

  it('loads notification deduplication settings when Discord is configured', () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';
    process.env.DISCORD_WEBHOOK_ID = '123';
    process.env.NOTIFICATION_DEDUPLICATION_WINDOW_MS = '15000';
    process.env.NOTIFICATION_DEDUPLICATION_MAX_SIZE = '250';

    const config = loadConfig();

    expect(config.discord).toMatchObject({
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      webhookId: '123',
      deduplicationWindowMs: 15000,
      deduplicationMaxSize: 250,
    });
  });

  describe('WEBHOOK_SECRETS', () => {
    it('defaults to an empty array when not set', () => {
      delete process.env.WEBHOOK_SECRETS;
      const config = loadConfig();
      expect(config.webhookSecrets).toEqual([]);
    });

    it('parses valid webhook secrets', () => {
      process.env.WEBHOOK_SECRETS = JSON.stringify([
        { id: 'key-1', secret: 'whsec_abc' },
        { id: 'key-2', secret: 'whsec_def' },
      ]);

      const config = loadConfig();
      expect(config.webhookSecrets).toEqual([
        { id: 'key-1', secret: 'whsec_abc' },
        { id: 'key-2', secret: 'whsec_def' },
      ]);
    });

    it('throws ConfigError for invalid JSON', () => {
      process.env.WEBHOOK_SECRETS = 'not-json';
      expect(() => loadConfig()).toThrow(ConfigError);
      expect(() => loadConfig()).toThrow('WEBHOOK_SECRETS must be valid JSON');
    });

    it('throws ConfigError when item is missing id', () => {
      process.env.WEBHOOK_SECRETS = JSON.stringify([{ secret: 'whsec_abc' }]);
      expect(() => loadConfig()).toThrow(ConfigError);
      expect(() => loadConfig()).toThrow('WEBHOOK_SECRETS[0].id must be a non-empty string');
    });

    it('throws ConfigError when item is missing secret', () => {
      process.env.WEBHOOK_SECRETS = JSON.stringify([{ id: 'key-1' }]);
      expect(() => loadConfig()).toThrow(ConfigError);
      expect(() => loadConfig()).toThrow('WEBHOOK_SECRETS[0].secret must be a non-empty string');
    });

    it('throws ConfigError when value is not an array', () => {
      process.env.WEBHOOK_SECRETS = '"string-value"';
      expect(() => loadConfig()).toThrow(ConfigError);
      expect(() => loadConfig()).toThrow('WEBHOOK_SECRETS must be a JSON array');
    });
  });
});
