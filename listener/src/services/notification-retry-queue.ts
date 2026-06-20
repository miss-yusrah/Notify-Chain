import * as StellarSDK from '@stellar/stellar-sdk';
import { ContractConfig } from '../types';
import logger from '../utils/logger';
import { getEventName } from '../utils/event-utils';

export interface RetryQueueOptions {
  baseDelayMs?: number;
  maxRetries?: number;
  processIntervalMs?: number;
}

interface RetryItem {
  event: StellarSDK.rpc.Api.EventResponse;
  contractConfig: ContractConfig;
  retryCount: number;
  nextRetryAt: number;
  requestId?: string;
}

const DEFAULTS = {
  baseDelayMs: 5_000,
  maxRetries: 5,
  processIntervalMs: 5_000,
};

export type NotificationFn = (
  event: StellarSDK.rpc.Api.EventResponse,
  contractConfig: ContractConfig,
  requestId?: string
) => Promise<boolean>;

export class NotificationRetryQueue {
  private queue: RetryItem[] = [];
  private readonly queuedFingerprints: Set<string> = new Set();
  private readonly baseDelayMs: number;
  private readonly maxRetries: number;
  private readonly processIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly notificationFn: NotificationFn;

  constructor(notificationFn: NotificationFn, options?: RetryQueueOptions) {
    this.notificationFn = notificationFn;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULTS.baseDelayMs;
    this.maxRetries = options?.maxRetries ?? DEFAULTS.maxRetries;
    this.processIntervalMs = options?.processIntervalMs ?? DEFAULTS.processIntervalMs;
  }

  enqueue(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig,
    requestId?: string
  ): void {
    const fingerprint = buildRetryFingerprint(event, contractConfig.address);

    if (this.queuedFingerprints.has(fingerprint)) {
      logger.info('Skipping duplicate retry queue entry', {
        requestId,
        eventId: event.id,
        contractAddress: contractConfig.address,
        fingerprint,
      });
      return;
    }

    const delayMs = this.calculateDelay(0);
    const nextRetryAt = Date.now() + delayMs;

    logger.info('Notification queued for retry', {
      requestId,
      eventId: event.id,
      contractAddress: contractConfig.address,
      delayMs,
      nextRetryAt: new Date(nextRetryAt).toISOString(),
      maxRetries: this.maxRetries,
    });

    this.queuedFingerprints.add(fingerprint);
    this.queue.push({ event, contractConfig, retryCount: 0, nextRetryAt, requestId });
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.processQueue().catch((err) =>
        logger.error('Unexpected error in retry queue processor', { error: err })
      );
    }, this.processIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  size(): number {
    return this.queue.length;
  }

  private async processQueue(): Promise<void> {
    const now = Date.now();
    const due = this.queue.filter((item) => item.nextRetryAt <= now);
    this.queue = this.queue.filter((item) => item.nextRetryAt > now);

    for (const item of due) {
      await this.retryItem(item);
    }
  }

  private async retryItem(item: RetryItem): Promise<void> {
    const attempt = item.retryCount + 1;
    const fingerprint = buildRetryFingerprint(item.event, item.contractConfig.address);

    logger.info('Retrying failed notification', {
      requestId: item.requestId,
      eventId: item.event.id,
      contractAddress: item.contractConfig.address,
      attempt,
      maxRetries: this.maxRetries,
    });

    const success = await this.notificationFn(item.event, item.contractConfig, item.requestId);

    if (success) {
      this.queuedFingerprints.delete(fingerprint);
      logger.info('Retry succeeded', {
        requestId: item.requestId,
        eventId: item.event.id,
        contractAddress: item.contractConfig.address,
        attempt,
      });
      return;
    }

    if (attempt >= this.maxRetries) {
      this.queuedFingerprints.delete(fingerprint);
      logger.error('Notification permanently failed after max retries', {
        requestId: item.requestId,
        eventId: item.event.id,
        contractAddress: item.contractConfig.address,
        totalAttempts: attempt,
      });
      return;
    }

    const delayMs = this.calculateDelay(attempt);
    const nextRetryAt = Date.now() + delayMs;

    logger.warn('Retry failed, scheduling next attempt', {
      requestId: item.requestId,
      eventId: item.event.id,
      contractAddress: item.contractConfig.address,
      attempt,
      delayMs,
      nextRetryAt: new Date(nextRetryAt).toISOString(),
    });

    this.queue.push({ ...item, retryCount: attempt, nextRetryAt });
  }

  private calculateDelay(retryCount: number): number {
    return this.baseDelayMs * Math.pow(2, retryCount);
  }
}

function buildRetryFingerprint(
  event: StellarSDK.rpc.Api.EventResponse,
  contractAddress: string
): string {
  const eventName =
    getEventName(event.topic) ?? event.topic.map((entry) => entry.toString()).join('|');
  return `${contractAddress}:${event.id}:${eventName}:${event.txHash ?? ''}`;
}
