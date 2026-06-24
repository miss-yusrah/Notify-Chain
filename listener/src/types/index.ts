export interface ContractConfig {
  address: string;
  events: string[];
  /** Optional user ID for per-user notification preference gating */
  userId?: string;
}

export interface DiscordConfig {
  webhookUrl: string;
  webhookId: string;
  deduplicationWindowMs?: number;
  deduplicationMaxSize?: number;
  timeoutMs?: number;
}

export interface RetryQueueConfig {
  baseDelayMs?: number;
  maxRetries?: number;
}

export interface WebhookSecret {
  id: string;
  secret: string;
}  
  
export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  clientOverrides: Record<string, { maxRequests: number; windowMs?: number }>;
}

export interface Config {
  stellarNetwork: string;
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  contractAddresses: ContractConfig[];
  pollIntervalMs: number;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  eventsApiPort: number;
  eventsApiCorsOrigin: string;
  discord?: DiscordConfig;
  retryQueue?: RetryQueueConfig;
  webhookSecrets?: WebhookSecret[];
  scheduler?: SchedulerConfig;
  databasePath?: string;
  rateLimit?: RateLimitConfig;
}

export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  processorId?: string;
  batchSize: number;
  timingBufferMs: number;
}

