interface PaginationControlsProps {
  page: number;
  pageCount: number;
  limit: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

const LIMIT_OPTIONS = [8, 12, 20, 40];

export function PaginationControls({
  page,
  pageCount,
  limit,
  totalCount,
  onPageChange,
  onLimitChange,
}: PaginationControlsProps) {
  const handlePrevious = () => {
    onPageChange(Math.max(1, page - 1));
  };

  const handleNext = () => {
    onPageChange(Math.min(pageCount, page + 1));
  };

  return (
    <section className="pagination-controls" aria-label="Pagination controls">
      <div className="pagination-controls__summary">
        <span>
          Page {page} of {pageCount}
        </span>
        <span>{totalCount.toLocaleString()} total events</span>
      </div>

      <div className="pagination-controls__actions">
        <button
          type="button"
          className="pagination-controls__button"
          onClick={handlePrevious}
          disabled={page <= 1}
        >
          Previous
        </button>

        <label className="pagination-controls__label" htmlFor="items-per-page">
          Items per page
        </label>
        <select
          id="items-per-page"
          className="pagination-controls__select"
          value={limit}
          onChange={(event) => onLimitChange(Number(event.target.value))}
        >
          {LIMIT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="pagination-controls__button"
          onClick={handleNext}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </section>
  );
}
