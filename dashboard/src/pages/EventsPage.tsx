import { useEffect } from 'react';
import { EventFiltersBar } from '../components/EventFiltersBar';
import { EventListPanel } from '../components/EventListPanel';
import { useEventLoadingState } from '../hooks/useEventSelectors';
import { useEventStore } from '../store/eventStore';
import { fetchEvents } from '../services/eventsApi';
import { generateMockEvents } from '../utils/eventData';

const DEFAULT_EVENT_COUNT = 5000;
const API_URL =
  import.meta.env.VITE_EVENTS_API_URL ?? 'http://localhost:8787/api/events';

export function EventsPage() {
  const setEvents = useEventStore((state) => state.setEvents);
  const setLoading = useEventStore((state) => state.setLoading);
  const setError = useEventStore((state) => state.setError);
  const { isLoading, error } = useEventLoadingState();

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setLoading(true);
      setError(null);

      try {
        const remoteEvents = await fetchEvents(API_URL);
        if (!cancelled) {
          setEvents(remoteEvents);
        }
      } catch {
        if (!cancelled) {
          setEvents(generateMockEvents(DEFAULT_EVENT_COUNT));
          setError('Listener API unavailable — showing mock events for demo.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadEvents();

    return () => {
      cancelled = true;
    };
  }, [setEvents, setError, setLoading]);

  return (
    <main className="events-page">
      <header className="events-page__header">
        <h1>Blockchain Events</h1>
        <p>Optimized rendering for large event datasets.</p>
      </header>

      <EventFiltersBar />

      <div aria-live="polite" role="status">
        {isLoading && <p className="events-page__status">Loading events...</p>}
      </div>
      <div aria-live="assertive" role="alert">
        {error && <p className="events-page__status events-page__status--warning">{error}</p>}
      </div>

      <EventListPanel />
    </main>
  );
}
