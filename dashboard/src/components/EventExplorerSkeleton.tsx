interface EventExplorerSkeletonProps {
  rows?: number;
}

export function EventExplorerSkeleton({ rows = 6 }: EventExplorerSkeletonProps) {
  return (
    <section className="event-explorer__table-wrapper event-explorer__skeleton" aria-busy="true">
      <div className="event-explorer__table-body">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <article key={rowIndex} className="event-explorer__row event-explorer__row--loading">
            <div className="event-explorer__cell" />
            <div className="event-explorer__cell" />
            <div className="event-explorer__cell" />
            <div className="event-explorer__cell" />
            <div className="event-explorer__cell" />
            <div className="event-explorer__cell" />
          </article>
        ))}
      </div>
    </section>
  );
}
