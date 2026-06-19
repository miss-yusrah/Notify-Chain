export interface ContractConfig {
  address: string;
  events: string[];
}

export interface DiscordConfig {
  webhookUrl: string;
  webhookId: string;
  deduplicationWindowMs?: number;
  deduplicationMaxSize?: number;
}

export interface RetryQueueConfig {
  baseDelayMs?: number;
  maxRetries?: number;
}

export interface Config {
  stellarNetwork: string;
  stellarRpcUrl: string;
  contractAddresses: ContractConfig[];
  pollIntervalMs: number;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  eventsApiPort: number;
  eventsApiCorsOrigin: string;
  discord?: DiscordConfig;
  retryQueue?: RetryQueueConfig;
  scheduler?: SchedulerConfig;
  databasePath?: string;
}

export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  processorId?: string;
  batchSize: number;
  timingBufferMs: number;
}

