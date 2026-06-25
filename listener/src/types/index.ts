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
  multiplier?: number;
  jitter?: boolean;
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
  eventQueue?: EventQueueConfig;
  webhookSecrets?: WebhookSecret[];
  scheduler?: SchedulerConfig;
  retryScheduler?: RetrySchedulerOptions;
  databasePath?: string;
  rateLimit?: RateLimitConfig;
  cleanup?: AppCleanupConfig;
}

export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  processorId?: string;
  batchSize: number;
  timingBufferMs: number;
}

export interface EventQueueConfig {
  /** Maximum number of events to process concurrently (default: 1, must be >= 1). */
  maxConcurrency?: number;
  /** Maximum retry attempts per event (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 2000). */
  baseDelayMs?: number;
  /** How often to poll the queue for due events in ms (default: 1000). */
  pollIntervalMs?: number;
}

export interface AppCleanupConfig {
  /** How often to run cleanup jobs (ms). */
  intervalMs: number;
  /** Retain completed/failed/cancelled notifications for this long (ms). */
  notificationRetentionMs: number;
  /** Retain rate-limit audit rows for this long (ms). */
  rateLimitEventRetentionMs: number;
  /** Retain in-memory events for this long (ms). */
  eventRetentionMs: number;
}

export interface RetrySchedulerOptions {
  enabled: boolean;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  processorId?: string;
  batchSize: number;
  baseDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  jitter: boolean;
}

