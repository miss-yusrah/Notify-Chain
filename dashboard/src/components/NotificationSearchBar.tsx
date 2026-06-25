import { useState, useEffect, memo } from 'react';
import { useEventStore } from '../store/eventStore';
import { useEventFilters } from '../hooks/useEventSelectors';
import { useDebounce } from '../hooks/useDebounce';
import type { NotificationStatus } from '../types/event';

const STATUS_OPTIONS: { value: NotificationStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
];

export const NotificationSearchBar = memo(function NotificationSearchBar() {
  const filters = useEventFilters();
  const setSearch = useEventStore((s) => s.setSearch);
  const setStatusFilter = useEventStore((s) => s.setStatusFilter);
  const setDateFrom = useEventStore((s) => s.setDateFrom);
  const setDateTo = useEventStore((s) => s.setDateTo);

  // Local state for the text input so debounce doesn't block typing
  const [inputValue, setInputValue] = useState(filters.search);
  const debouncedSearch = useDebounce(inputValue, 250);

  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch, setSearch]);

  // Keep local value in sync if store is cleared externally
  useEffect(() => {
    if (filters.search === '' && inputValue !== '') setInputValue('');
    // intentionally only react to store reset, not every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  return (
    <section className="notif-search" aria-label="Notification search and filters">
      {/* Text search */}
      <div className="notif-search__group notif-search__group--wide">
        <label htmlFor="notif-search-input" className="notif-search__label">
          Search notifications
        </label>
        <input
          id="notif-search-input"
          type="search"
          className="notif-search__input"
          placeholder="Event name, ID, contract, tx hash…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          aria-label="Search notifications"
        />
      </div>

      {/* Status filter */}
      <div className="notif-search__group">
        <span className="notif-search__label" id="notif-status-label">
          Status
        </span>
        <div
          className="notif-search__status-group"
          role="group"
          aria-labelledby="notif-status-label"
        >
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`notif-search__status-btn${filters.status === value ? ' notif-search__status-btn--active' : ''}`}
              aria-pressed={filters.status === value}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="notif-search__group">
        <label htmlFor="notif-date-from" className="notif-search__label">
          From
        </label>
        <input
          id="notif-date-from"
          type="date"
          className="notif-search__input notif-search__input--date"
          value={filters.dateFrom}
          max={filters.dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Filter from date"
        />
      </div>

      <div className="notif-search__group">
        <label htmlFor="notif-date-to" className="notif-search__label">
          To
        </label>
        <input
          id="notif-date-to"
          type="date"
          className="notif-search__input notif-search__input--date"
          value={filters.dateTo}
          min={filters.dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Filter to date"
        />
      </div>

      {/* Clear all */}
      {(inputValue || filters.status !== 'all' || filters.dateFrom || filters.dateTo) && (
        <button
          type="button"
          className="notif-search__clear"
          onClick={() => {
            setInputValue('');
            setStatusFilter('all');
            setDateFrom('');
            setDateTo('');
          }}
          aria-label="Clear all filters"
        >
          Clear filters
        </button>
      )}
    </section>
  );
});
