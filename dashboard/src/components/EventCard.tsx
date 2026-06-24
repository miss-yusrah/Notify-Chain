import { memo, type KeyboardEvent } from 'react';
import type { BlockchainEvent } from '../types/event';
import { formatTimestamp, formatTimestampShort } from '../utils/formatTime';

export type EventCardVariant = 'compact' | 'expanded';

export interface EventCardProps {
  event?: BlockchainEvent;
  variant?: EventCardVariant;
  isLoading?: boolean;
  onClick?: (event: BlockchainEvent) => void;
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  TaskCreated: 'event-card__badge--green',
  WorkSubmitted: 'event-card__badge--blue',
  SubmissionApproved: 'event-card__badge--green',
  SubmissionRejected: 'event-card__badge--red',
  TaskCancelled: 'event-card__badge--red',
  DisputeRaised: 'event-card__badge--yellow',
  AutoshareCreated: 'event-card__badge--purple',
  Withdrawal: 'event-card__badge--orange',
};

function getEventBadgeClass(name: string | null): string {
  if (!name) return 'event-card__badge--default';
  return EVENT_TYPE_COLORS[name] ?? 'event-card__badge--default';
}

function SkeletonLine({ width = '100%', height = '14px' }: { width?: string; height?: string }) {
  return (
    <span
      className="event-card__skeleton"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

function LoadingCard({ variant }: { variant: EventCardVariant }) {
  return (
    <article className={`event-card event-card--${variant} event-card--loading`} aria-busy="true">
      {variant === 'compact' ? (
        <>
          <div className="event-card__primary">
            <SkeletonLine width="120px" height="16px" />
            <SkeletonLine width="80px" />
          </div>
          <div className="event-card__meta">
            <SkeletonLine width="150px" />
            <SkeletonLine width="90px" />
          </div>
          <div className="event-card__details">
            <SkeletonLine width="100px" />
            <SkeletonLine width="120px" />
          </div>
        </>
      ) : (
        <>
          <div className="event-card__header">
            <SkeletonLine width="160px" height="20px" />
            <SkeletonLine width="70px" height="22px" />
          </div>
          <div className="event-card__body">
            <div className="event-card__field">
              <SkeletonLine width="80px" />
              <SkeletonLine width="260px" />
            </div>
            <div className="event-card__field">
              <SkeletonLine width="80px" />
              <SkeletonLine width="200px" />
            </div>
            <div className="event-card__field">
              <SkeletonLine width="80px" />
              <SkeletonLine width="60px" />
            </div>
            <div className="event-card__field">
              <SkeletonLine width="80px" />
              <SkeletonLine width="140px" />
            </div>
            <div className="event-card__field">
              <SkeletonLine width="80px" />
              <SkeletonLine width="220px" />
            </div>
          </div>
        </>
      )}
    </article>
  );
}

function handleActivationKey(onClick: (e: BlockchainEvent) => void, event: BlockchainEvent) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(event);
    }
  };
}

function CompactCard({ event, onClick }: { event: BlockchainEvent; onClick?: (e: BlockchainEvent) => void }) {
  const displayName = event.eventName ?? event.type;
  const badgeClass = getEventBadgeClass(event.eventName);
  const Wrapper = onClick ? 'div' : 'article';

  return (
    <Wrapper
      className={`event-card event-card--compact${onClick ? ' event-card--clickable' : ''}`}
      data-event-id={event.eventId}
      onClick={onClick ? () => onClick(event) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View details for ${displayName} event` : undefined}
      onKeyDown={onClick ? handleActivationKey(onClick, event) : undefined}
    >
      <div className="event-card__primary">
        <span className={`event-card__badge ${badgeClass}`}>{displayName}</span>
        <span className="event-card__ledger">Ledger {event.ledger}</span>
      </div>
      <div className="event-card__meta">
        <span className="event-card__address" title={event.contractAddress}>
          {shortenAddress(event.contractAddress)}
        </span>
        <span className="event-card__time" title={formatTimestamp(event.receivedAt)}>
          {formatTimestampShort(event.receivedAt)}
        </span>
      </div>
      <div className="event-card__details">
        <span>Value: {event.value}</span>
        {event.txHash && (
          <span title={event.txHash}>Tx: {shortenAddress(event.txHash)}</span>
        )}
      </div>
    </Wrapper>
  );
}

function ExpandedCard({ event, onClick }: { event: BlockchainEvent; onClick?: (e: BlockchainEvent) => void }) {
  const displayName = event.eventName ?? event.type;
  const badgeClass = getEventBadgeClass(event.eventName);
  const Wrapper = onClick ? 'div' : 'article';

  return (
    <Wrapper
      className={`event-card event-card--expanded${onClick ? ' event-card--clickable' : ''}`}
      data-event-id={event.eventId}
      onClick={onClick ? () => onClick(event) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View details for ${displayName} event` : undefined}
      onKeyDown={onClick ? handleActivationKey(onClick, event) : undefined}
    >
      <div className="event-card__header">
        <h3 className="event-card__title">{displayName}</h3>
        <span className={`event-card__badge ${badgeClass}`}>{event.type}</span>
      </div>

      <div className="event-card__body">
        <dl className="event-card__fields">
          <div className="event-card__field">
            <dt>Contract</dt>
            <dd title={event.contractAddress}>{event.contractAddress}</dd>
          </div>

          {event.txHash && (
            <div className="event-card__field">
              <dt>Tx Hash</dt>
              <dd title={event.txHash}>{event.txHash}</dd>
            </div>
          )}

          <div className="event-card__field">
            <dt>Ledger</dt>
            <dd>{event.ledger.toLocaleString()}</dd>
          </div>

          <div className="event-card__field">
            <dt>Value</dt>
            <dd>{event.value}</dd>
          </div>

          {event.topic.length > 0 && (
            <div className="event-card__field">
              <dt>Topics</dt>
              <dd>
                <ul className="event-card__topics">
                  {event.topic.map((t, i) => (
                    <li key={i} className="event-card__topic-item">{t}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          <div className="event-card__field">
            <dt>Received</dt>
            <dd>{formatTimestamp(event.receivedAt)}</dd>
          </div>

          <div className="event-card__field">
            <dt>Event ID</dt>
            <dd className="event-card__id">{event.eventId}</dd>
          </div>
        </dl>
      </div>
    </Wrapper>
  );
}

export const EventCard = memo(function EventCard({
  event,
  variant = 'compact',
  isLoading = false,
  onClick,
}: EventCardProps) {
  if (isLoading) {
    return <LoadingCard variant={variant} />;
  }

  if (!event) {
    return null;
  }

  if (variant === 'expanded') {
    return <ExpandedCard event={event} onClick={onClick} />;
  }

  return <CompactCard event={event} onClick={onClick} />;
});