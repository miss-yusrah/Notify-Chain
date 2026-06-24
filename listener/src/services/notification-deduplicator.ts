import logger from '../utils/logger';

const DEFAULT_MAX_SIZE = 10000;
const DEFAULT_WINDOW_MS = 60000;

export function generateFingerprint(eventId: string, contractAddress: string): string {
  return `${contractAddress}:${eventId}`;
}

export interface NotificationDeduplicatorOptions {
  maxSize?: number;
  windowMs?: number;
  now?: () => number;
}

export interface NotificationDeduplicationMetrics {
  acceptedRequests: number;
  skippedDuplicates: number;
  evictedEntries: number;
  expiredEntries: number;
  cacheSize: number;
  deduplicationWindowMs: number;
}

export class NotificationDeduplicator {
  private readonly seen: Map<string, number>;
  private readonly maxSize: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private acceptedRequests = 0;
  private skippedDuplicates = 0;
  private evictedEntries = 0;
  private expiredEntries = 0;

  constructor(options: NotificationDeduplicatorOptions | number = {}) {
    const normalizedOptions = typeof options === 'number' ? { maxSize: options } : options;
    this.seen = new Map();
    this.maxSize = Math.max(1, normalizedOptions.maxSize ?? DEFAULT_MAX_SIZE);
    this.windowMs = Math.max(1, normalizedOptions.windowMs ?? DEFAULT_WINDOW_MS);
    this.now = normalizedOptions.now ?? Date.now;
  }

  isDuplicate(fingerprint: string): boolean {
    this.pruneExpired();
    const expiresAt = this.seen.get(fingerprint);
    const duplicate = expiresAt !== undefined && expiresAt > this.now();

    if (duplicate) {
      this.skippedDuplicates++;
    }

    return duplicate;
  }

  markSent(fingerprint: string): void {
    this.pruneExpired();
    if (this.seen.size >= this.maxSize) {
      const oldest = this.seen.keys().next().value as string;
      this.seen.delete(oldest);
      this.evictedEntries++;
      logger.warn('Notification deduplicator cache full, evicted oldest entry', {
        evicted: oldest,
        cacheSize: this.maxSize,
      });
    }
    this.seen.set(fingerprint, this.now() + this.windowMs);
    this.acceptedRequests++;
  }

  size(): number {
    this.pruneExpired();
    return this.seen.size;
  }

  getMetrics(): NotificationDeduplicationMetrics {
    return {
      acceptedRequests: this.acceptedRequests,
      skippedDuplicates: this.skippedDuplicates,
      evictedEntries: this.evictedEntries,
      expiredEntries: this.expiredEntries,
      cacheSize: this.size(),
      deduplicationWindowMs: this.windowMs,
    };
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [fingerprint, expiresAt] of this.seen) {
      if (expiresAt > now) {
        continue;
      }

      this.seen.delete(fingerprint);
      this.expiredEntries++;
    }
  }
}
