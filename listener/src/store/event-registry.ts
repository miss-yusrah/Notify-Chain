import { DisplayEvent } from '../types/display-event';
import { RegistryEventInput } from '../types/registry-event-input';
import { formatScValArray, formatScValValue } from '../utils/scval-format';
import logger from '../utils/logger';

const DEFAULT_MAX_EVENTS = 10000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class EventRegistry {
  private events: DisplayEvent[] = [];
  private readonly maxEvents: number;
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastIngestedLedger: number | null = null;
  private lastIngestedAt: number | null = null;
  private maxLedgerSeen: number | null = null;

  constructor(maxEvents = DEFAULT_MAX_EVENTS, ttlMs = DEFAULT_TTL_MS) {
    this.maxEvents = maxEvents;
    this.ttlMs = ttlMs;
  }

  setTtlMs(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.pruneExpired(), intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  pruneExpired(): number {
    const cutoff = Date.now() - this.ttlMs;
    const before = this.events.length;
    this.events = this.events.filter((e) => e.receivedAt >= cutoff);
    const removed = before - this.events.length;
    if (removed > 0) {
      logger.info('Pruned expired events from registry', { removed, remaining: this.events.length });
    }
    return removed;
  }

  addFromInput(input: RegistryEventInput): DisplayEvent {
    const topic = formatScValArray(input.topic);
    const displayEvent: DisplayEvent = {
      eventId: input.eventId,
      contractAddress: input.contractAddress,
      eventName: input.eventName ?? topic[0] ?? null,
      ledger: input.ledger,
      type: input.type,
      topic,
      value: formatScValValue(input.value),
      txHash: input.txHash,
      receivedAt: Date.now(),
    };

    this.events.push(displayEvent);
    this.lastIngestedLedger = displayEvent.ledger;
    this.lastIngestedAt = displayEvent.receivedAt;
    this.maxLedgerSeen =
      this.maxLedgerSeen === null ? displayEvent.ledger : Math.max(this.maxLedgerSeen, displayEvent.ledger);

    if (this.events.length > this.maxEvents) {
      const evicted = this.events.length - this.maxEvents;
      this.events = this.events.slice(this.events.length - this.maxEvents);
      logger.warn('Event registry at capacity, evicting oldest events', {
        maxEvents: this.maxEvents,
        evicted,
      });
    }

    return displayEvent;
  }

  getEvents(limit?: number): DisplayEvent[] {
    if (limit === undefined || limit >= this.events.length) {
      return [...this.events];
    }
    return this.events.slice(this.events.length - limit);
  }

  count(): number {
    return this.events.length;
  }

  /**
   * Returns ingestion metadata for the most recently ingested event.
   * Used by observability endpoints (e.g. indexing health).
   */
  getIngestionSnapshot(): {
    lastIngestedLedger: number | null;
    lastIngestedAt: number | null;
    maxLedgerSeen: number | null;
  } {
    return {
      lastIngestedLedger: this.lastIngestedLedger,
      lastIngestedAt: this.lastIngestedAt,
      maxLedgerSeen: this.maxLedgerSeen,
    };
  }

  clear(): void {
    this.events = [];
    this.lastIngestedLedger = null;
    this.lastIngestedAt = null;
    this.maxLedgerSeen = null;
  }
}

export const eventRegistry = new EventRegistry();
