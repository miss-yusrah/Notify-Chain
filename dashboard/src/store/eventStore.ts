import { create } from 'zustand';
import type { BlockchainEvent, EventFilters } from '../types/event';
import { filterEvents } from '../utils/eventData';

interface EventStoreState {
  events: BlockchainEvent[];
  filters: EventFilters;
  isLoading: boolean;
  error: string | null;
  setEvents: (events: BlockchainEvent[]) => void;
  appendEvents: (events: BlockchainEvent[]) => void;
  setSearch: (search: string) => void;
  setContractFilter: (contractAddress: string) => void;
  setEventTypeFilter: (eventType: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

function dedupeEventsById(events: BlockchainEvent[]): BlockchainEvent[] {
  const seenEventIds = new Set<string>();

  return events.filter((event) => {
    if (seenEventIds.has(event.eventId)) {
      return false;
    }

    seenEventIds.add(event.eventId);
    return true;
  });
}

export const useEventStore = create<EventStoreState>((set) => ({
  events: [],
  filters: {
    search: '',
    contractAddress: 'all',
    eventType: 'all',
  },
  isLoading: false,
  error: null,
  setEvents: (events) => set({ events: dedupeEventsById(events) }),
  appendEvents: (events) =>
    set((state) => ({
      events: dedupeEventsById([...state.events, ...events]),
    })),
  setSearch: (search) =>
    set((state) => ({
      filters: { ...state.filters, search },
    })),
  setContractFilter: (contractAddress) =>
    set((state) => ({
      filters: { ...state.filters, contractAddress },
    })),
  setEventTypeFilter: (eventType) =>
    set((state) => ({
      filters: { ...state.filters, eventType },
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

export function selectFilteredEvents(state: EventStoreState): BlockchainEvent[] {
  const { events, filters } = state;
  return filterEvents(
    events,
    filters.search,
    filters.contractAddress,
    filters.eventType
  );
}

export function selectEventCount(state: EventStoreState): number {
  return state.events.length;
}

export function selectFilters(state: EventStoreState): EventFilters {
  return state.filters;
}

export function selectContractOptions(state: EventStoreState): string[] {
  return Array.from(new Set(state.events.map((event) => event.contractAddress)));
}

export function selectEventTypeOptions(state: EventStoreState): string[] {
  return Array.from(
    new Set(
      state.events
        .map((event) => event.eventName)
        .filter((name): name is string => Boolean(name))
    )
  );
}
