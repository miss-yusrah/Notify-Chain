import * as StellarSDK from '@stellar/stellar-sdk';
import { ContractConfig } from '../types';
import logger from '../utils/logger';

export interface EventProcessingQueueOptions {
  maxConcurrency?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

export type EventProcessor = (
  event: StellarSDK.rpc.Api.EventResponse,
  contractConfig: ContractConfig,
  requestId?: string
) => Promise<boolean>;

interface QueuedEvent {
  event: StellarSDK.rpc.Api.EventResponse;
  contractConfig: ContractConfig;
  requestId: string;
  retryCount: number;
  nextRetryAt: number;
  fingerprint: string;
}

const DEFAULTS = {
  maxConcurrency: 1,
  pollIntervalMs: 1_000,
  maxRetries: 3,
  baseDelayMs: 2_000,
};

export class EventProcessingQueue {
  private queue: QueuedEvent[] = [];
  private readonly queuedFingerprints: Set<string> = new Set();
  private readonly activeFingerprints: Set<string> = new Set();
  private readonly maxConcurrency: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly processor: EventProcessor;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(processor: EventProcessor, options?: EventProcessingQueueOptions) {
    this.processor = processor;
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? DEFAULTS.maxConcurrency);
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.maxRetries = options?.maxRetries ?? DEFAULTS.maxRetries;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULTS.baseDelayMs;
  }

  enqueue(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig,
    requestId?: string
  ): boolean {
    const fingerprint = buildEventFingerprint(event, contractConfig.address);

    if (this.queuedFingerprints.has(fingerprint)) {
      logger.info('Skipping duplicate event queue entry', {
        requestId,
        eventId: event.id,
        contractAddress: contractConfig.address,
        fingerprint,
      });
      return false;
    }

    const delayMs = this.calculateDelay(0);
    const nextRetryAt = Date.now() + delayMs;

    logger.info('Event queued for processing', {
      requestId,
      eventId: event.id,
      contractAddress: contractConfig.address,
      delayMs,
      nextRetryAt: new Date(nextRetryAt).toISOString(),
      maxRetries: this.maxRetries,
    });

    this.queuedFingerprints.add(fingerprint);
    this.queue.push({
      event,
      contractConfig,
      requestId: requestId ?? '',
      retryCount: 0,
      nextRetryAt,
      fingerprint,
    });

    return true;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.processNext().catch((err) =>
        logger.error('Unexpected error in event processing queue', { error: err })
      );
    }, this.pollIntervalMs);
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

  pendingCount(): number {
    return this.queue.length;
  }

  private async processNext(): Promise<void> {
    const available = this.maxConcurrency - this.activeFingerprints.size;
    if (available <= 0) return;

    const now = Date.now();

    const due = this.queue
      .filter((item) => item.nextRetryAt <= now && !this.activeFingerprints.has(item.fingerprint))
      .slice(0, available);

    if (due.length === 0) return;

    const selectedFingerprints = new Set(due.map((item) => item.fingerprint));

    this.queue = this.queue.filter(
      (item) =>
        item.nextRetryAt > now ||
        this.activeFingerprints.has(item.fingerprint) ||
        !selectedFingerprints.has(item.fingerprint)
    );

    const results = await Promise.allSettled(due.map((item) => this.processItem(item)));

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('Unexpected rejection in event processing queue', {
          error: result.reason,
        });
      }
    }
  }

  private async processItem(item: QueuedEvent): Promise<void> {
    this.activeFingerprints.add(item.fingerprint);

    try {
      const success = await this.processor(item.event, item.contractConfig, item.requestId);

      if (success) {
        this.queuedFingerprints.delete(item.fingerprint);
        this.activeFingerprints.delete(item.fingerprint);
        logger.info('Event processing succeeded', {
          requestId: item.requestId,
          eventId: item.event.id,
          contractAddress: item.contractConfig.address,
        });
        return;
      }

      const attempt = item.retryCount + 1;

      if (attempt >= this.maxRetries) {
        this.queuedFingerprints.delete(item.fingerprint);
        this.activeFingerprints.delete(item.fingerprint);
        logger.error('Event processing permanently failed after max retries', {
          requestId: item.requestId,
          eventId: item.event.id,
          contractAddress: item.contractConfig.address,
          totalAttempts: attempt,
        });
        return;
      }

      const delayMs = this.calculateDelay(attempt);
      const nextRetryAt = Date.now() + delayMs;

      logger.warn('Event processing failed, scheduling retry', {
        requestId: item.requestId,
        eventId: item.event.id,
        contractAddress: item.contractConfig.address,
        attempt,
        delayMs,
        nextRetryAt: new Date(nextRetryAt).toISOString(),
      });

      this.activeFingerprints.delete(item.fingerprint);
      this.queue.push({ ...item, retryCount: attempt, nextRetryAt });
    } catch (error) {
      this.activeFingerprints.delete(item.fingerprint);

      const attempt = item.retryCount + 1;

      if (attempt >= this.maxRetries) {
        this.queuedFingerprints.delete(item.fingerprint);
        logger.error('Event processing crashed after max retries', {
          requestId: item.requestId,
          eventId: item.event.id,
          contractAddress: item.contractConfig.address,
          totalAttempts: attempt,
          error,
        });
        return;
      }

      const delayMs = this.calculateDelay(attempt);
      const nextRetryAt = Date.now() + delayMs;

      logger.error('Event processing crashed, scheduling retry', {
        requestId: item.requestId,
        eventId: item.event.id,
        contractAddress: item.contractConfig.address,
        attempt,
        delayMs,
        error,
      });

      this.queue.push({ ...item, retryCount: attempt, nextRetryAt });
    }
  }

  private calculateDelay(retryCount: number): number {
    return this.baseDelayMs * Math.pow(2, retryCount);
  }
}

function buildEventFingerprint(
  event: StellarSDK.rpc.Api.EventResponse,
  contractAddress: string
): string {
  return `${contractAddress}:${event.id}`;
}
