import { useCallback, useEffect, useMemo, useState } from 'react';
import { EventFiltersBar } from '../components/EventFiltersBar';
import { NotificationSearchBar } from '../components/NotificationSearchBar';
import { WalletConnectButton } from '../components/WalletConnectButton';
import { EventExplorerTable } from '../components/EventExplorerTable';
import { EventExplorerSkeleton } from '../components/EventExplorerSkeleton';
import { PaginationControls } from '../components/PaginationControls';
import { IndexingHealthPanel } from '../components/IndexingHealthPanel';
import { useEventFilters, useEventLoadingState, useFilteredEvents } from '../hooks/useEventSelectors';
import { useEventStore } from '../store/eventStore';
import { fetchEvents, fetchStatus, type ContractStatus } from '../services/eventsApi';
import { fetchEvents } from '../services/eventsApi';
import { resolveIndexingHealthUrl } from '../services/indexingHealthApi';
import { generateMockEvents } from '../utils/eventData';
import { restoreWalletSession } from '../services/wallet';

const DEFAULT_EVENT_COUNT = 5000;
const DEFAULT_LIMIT = 12;
const API_URL = import.meta.env.VITE_EVENTS_API_URL ?? 'http://localhost:8787/api/events';
const LISTENER_BASE_URL = API_URL.replace('/api/events', '');
const INDEXING_HEALTH_URL =
  import.meta.env.VITE_INDEXING_HEALTH_URL ?? resolveIndexingHealthUrl(API_URL);

function parsePageParam(search: string) {
  const params = new URLSearchParams(search);
  const value = Number(params.get('page'));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function parseLimitParam(search: string) {
  const params = new URLSearchParams(search);
  const value = Number(params.get('limit'));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

export function EventExplorerPage() {
  const initialSearch = typeof window !== 'undefined' ? window.location.search : '';
  const [page, setPage] = useState(() => parsePageParam(initialSearch));
  const [limit, setLimit] = useState(() => parseLimitParam(initialSearch));
  const [contractStatuses, setContractStatuses] = useState<ContractStatus[]>([]);

  const setEvents = useEventStore((state) => state.setEvents);
  const setLoading = useEventStore((state) => state.setLoading);
  const setError = useEventStore((state) => state.setError);
  const { isLoading, error } = useEventLoadingState();
  const filters = useEventFilters();
  const filteredEvents = useFilteredEvents();

  useEffect(() => {
    restoreWalletSession();
  }, []);

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

    async function loadStatus() {
      try {
        const status = await fetchStatus(LISTENER_BASE_URL);
        if (!cancelled) {
          setContractStatuses(status.contracts);
        }
      } catch {
        // Ignore status fetch errors, just don't show status
      }
    }

    loadEvents();
    loadStatus();
    loadEvents();

    return () => {
      cancelled = true;
    };
  }, [setEvents, setError, setLoading]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredEvents.length / limit)),
    [filteredEvents.length, limit]
  );

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [pageCount, page]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.contractAddress, filters.eventType, filters.status, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set('page', String(page));
    params.set('limit', String(limit));

    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, [page, limit]);

  const currentPageEvents = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredEvents.slice(startIndex, startIndex + limit);
  }, [filteredEvents, page, limit]);

  const fromIndex = filteredEvents.length === 0 ? 0 : (page - 1) * limit + 1;
  const toIndex = Math.min(filteredEvents.length, page * limit);

  const handleRetry = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const remoteEvents = await fetchEvents(API_URL);
      setEvents(remoteEvents);
    } catch {
      setEvents(generateMockEvents(DEFAULT_EVENT_COUNT));
      setError('Retry failed — still using demo event data.');
    } finally {
      setLoading(false);
    }
  }, [setError, setEvents, setLoading]);

  return (
    <main className="event-explorer-page">
      <header className="event-explorer__header">
        <div>
          <p className="event-explorer__eyebrow">Event Explorer</p>
          <h1>Smart Contract Event Log</h1>
          <p className="event-explorer__lead">
            Browse Soroban contract events across registered contracts with filters,
            pagination, and copy-to-clipboard contract metadata.
          </p>
        </div>
        <WalletConnectButton />
      </header>

      {contractStatuses.length > 0 && (
        <section className="contract-statuses">
          <h2 className="contract-statuses__title">Contract Status</h2>
          <div className="contract-statuses__list">
            {contractStatuses.map((contract) => (
              <div key={contract.address} className="contract-status-card">
                <div className="contract-status-card__address">{contract.address}</div>
                <div className={`contract-status-card__badge ${contract.paused ? 'contract-status-card__badge--paused' : 'contract-status-card__badge--active'}`}>
                  {contract.paused ? 'PAUSED' : 'ACTIVE'}
                </div>
                {contract.error && (
                  <div className="contract-status-card__error">
                    Error: {contract.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <IndexingHealthPanel healthUrl={INDEXING_HEALTH_URL} />

      <EventFiltersBar />
      <NotificationSearchBar />

      {error && (
        <section className="event-explorer__error-banner" role="alert">
          <div>
            <strong>Error:</strong> {error}
          </div>
          <button type="button" className="event-explorer__retry-button" onClick={handleRetry}>
            Retry
          </button>
        </section>
      )}

      <div className="event-explorer__status-row">
        <p className="event-explorer__summary">
          Showing {fromIndex.toLocaleString()}–{toIndex.toLocaleString()} of{' '}
          {filteredEvents.length.toLocaleString()} events
        </p>
        {isLoading && <p className="event-explorer__loading-note">Loading events…</p>}
      </div>

      {isLoading ? (
        <EventExplorerSkeleton rows={Math.min(limit, 8)} />
      ) : currentPageEvents.length > 0 ? (
        <EventExplorerTable events={currentPageEvents} contractStatuses={contractStatuses} />
        <EventExplorerTable events={currentPageEvents} />
      ) : (
        <section className="event-explorer__empty-state" role="status" aria-live="polite">
          <h2>No events found</h2>
          <p>
            Update the search, event type, or contract filter to uncover matching Soroban
            contract events.
          </p>
        </section>
      )}

      <PaginationControls
        page={page}
        pageCount={pageCount}
        limit={limit}
        totalCount={filteredEvents.length}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </main>
  );
}
