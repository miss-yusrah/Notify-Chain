import { useState, useMemo, useEffect } from 'react';
import { generateMockExports, type NotificationExport } from '../utils/exportData';
import { WalletConnectButton } from '../components/WalletConnectButton';

export function ExportHistoryPage() {
  const [exports, setExports] = useState<NotificationExport[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    setExports(generateMockExports());
  }, []);

  // Filter exports
  const filteredExports = useMemo(() => {
    return exports.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) || 
        item.id.toLowerCase().includes(search.toLowerCase()) ||
        item.format.toLowerCase().includes(search.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || item.status.toLowerCase() === statusFilter.toLowerCase();
      
      return matchesSearch && matchesStatus;
    });
  }, [exports, search, statusFilter]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Calculate pagination
  const totalCount = filteredExports.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / limit));
  const displayedExports = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredExports.slice(startIndex, startIndex + limit);
  }, [filteredExports, page, limit]);

  // Adjust page if it exceeds pageCount
  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [pageCount, page]);

  // Format date helper
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Trigger download action
  const handleDownload = (item: NotificationExport) => {
    if (item.status !== 'Completed') return;

    let fileContent = '';
    let mimeType = 'text/plain';
    let fileExtension = 'txt';

    if (item.format === 'JSON') {
      fileContent = JSON.stringify(
        {
          export_id: item.id,
          export_name: item.name,
          format: item.format,
          created_at: new Date(item.createdAt).toISOString(),
          record_count: item.recordCount,
          records: Array.from({ length: 5 }, (_, i) => ({
            id: `notif-${2000 + i}`,
            contract: 'CCEMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5',
            event_name: i % 2 === 0 ? 'NotificationScheduled' : 'NotificationExpired',
            timestamp: new Date(item.createdAt - i * 15 * 60 * 1000).toISOString(),
            status: 'Delivered',
          })),
        },
        null,
        2
      );
      mimeType = 'application/json';
      fileExtension = 'json';
    } else if (item.format === 'CSV') {
      fileContent =
        'ID,Contract Address,Event Name,Timestamp,Status\n' +
        Array.from({ length: 5 }, (_, i) => 
          `notif-${2000 + i},CCEMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5,${
            i % 2 === 0 ? 'NotificationScheduled' : 'NotificationExpired'
          },${new Date(item.createdAt - i * 15 * 60 * 1000).toISOString()},Delivered`
        ).join('\n');
      mimeType = 'text/csv';
      fileExtension = 'csv';
    } else {
      fileContent = `Notify-Chain Notification Export Report\n` +
        `========================================\n` +
        `Export ID: ${item.id}\n` +
        `Export Name: ${item.name}\n` +
        `Date Generated: ${formatDate(item.createdAt)}\n` +
        `Total Records: ${item.recordCount}\n` +
        `File Size: ${item.fileSize}\n` +
        `========================================\n` +
        `* This is a mock PDF export file representation *`;
      mimeType = 'text/plain';
      fileExtension = 'txt';
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${item.id}.${fileExtension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="export-history-page">
      <header className="export-history__header">
        <div>
          <p className="export-history__eyebrow">Export Center</p>
          <h1>Notification Export History</h1>
          <p className="export-history__lead">
            Manage, filter, and download your previously generated notification and smart contract event export records.
          </p>
        </div>
        <WalletConnectButton />
      </header>

      {/* Filters Section */}
      <section className="export-filters" aria-label="Export history filters">
        <div className="event-filters__group">
          <label htmlFor="export-search">Search Exports</label>
          <input
            id="export-search"
            type="text"
            placeholder="Search by name, ID or format..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="event-filters__group">
          <label htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </section>

      {/* Table Section */}
      <div className="export-table-container">
        {displayedExports.length > 0 ? (
          <table className="export-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
                <th scope="col">Format</th>
                <th scope="col">Created At</th>
                <th scope="col" style={{ textAlign: 'right' }}>Records</th>
                <th scope="col" style={{ textAlign: 'right' }}>Size</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedExports.map((item) => (
                <tr key={item.id} className="export-table__row">
                  <td className="export-table__cell-id">{item.id}</td>
                  <td className="export-table__cell-name">{item.name}</td>
                  <td>
                    <span className={`format-badge format-badge--${item.format.toLowerCase()}`}>
                      {item.format}
                    </span>
                  </td>
                  <td className="export-table__cell-date">{formatDate(item.createdAt)}</td>
                  <td className="export-table__cell-numeric">{item.recordCount.toLocaleString()}</td>
                  <td className="export-table__cell-numeric">{item.fileSize}</td>
                  <td>
                    <span className={`status-badge status-badge--${item.status.toLowerCase()}`}>
                      <span className="status-badge__dot"></span>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="export-action-btn"
                      onClick={() => handleDownload(item)}
                      disabled={item.status !== 'Completed'}
                      aria-label={`Download ${item.name}`}
                    >
                      {item.status === 'Completed' ? (
                        <>
                          <svg
                            className="download-icon"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                          Download
                        </>
                      ) : item.status === 'Processing' ? (
                        'Generating...'
                      ) : (
                        'Unavailable'
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <section className="event-explorer__empty-state" role="status" aria-live="polite">
            <h2>No export records found</h2>
            <p>Try modifying your search query or status filter to locate matching exports.</p>
          </section>
        )}
      </div>

      {/* Custom Pagination */}
      <section className="pagination-controls" aria-label="Pagination controls">
        <div className="pagination-controls__summary">
          <span>
            Page {page} of {pageCount}
          </span>
          <span>{totalCount.toLocaleString()} total export records</span>
        </div>

        <div className="pagination-controls__actions">
          <button
            type="button"
            className="pagination-controls__button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>

          <label className="pagination-controls__label" htmlFor="exports-per-page">
            Show
          </label>
          <select
            id="exports-per-page"
            className="pagination-controls__select"
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            {[5, 10, 25].map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="pagination-controls__button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
