import { DisplayEvent } from '../types/display-event';
import { RegistryEventInput } from '../types/registry-event-input';
import { formatScValArray, formatScValValue } from '../utils/scval-format';
import logger from '../utils/logger';

const DEFAULT_MAX_EVENTS = 10000;

export class EventRegistry {
  private events: DisplayEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = DEFAULT_MAX_EVENTS) {
    this.maxEvents = maxEvents;
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

  clear(): void {
    this.events = [];
  }
}

export const eventRegistry = new EventRegistry();
