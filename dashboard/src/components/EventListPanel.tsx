import { memo } from 'react';
import { useFilteredEvents } from '../hooks/useEventSelectors';
import { EventList } from './EventList';

export const EventListPanel = memo(function EventListPanel() {
  const events = useFilteredEvents();

if (events.length === 0) {
    return (
      <div className="event-panel event-panel--empty" role="status" aria-live="polite">
        <p>No events match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="event-panel">
      <EventList events={events} />
    </div>
  );
});
