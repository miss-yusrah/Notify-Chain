import { memo } from 'react';
import type { BlockchainEvent } from '../types/event';
import { formatTimestamp } from '../utils/formatTime';

interface EventRowProps {
  event: BlockchainEvent;
}

function shortenAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const EventRow = memo(function EventRow({ event }: EventRowProps) {
  const label = event.eventName ?? event.type;

  return (
    <article className="event-row" data-event-id={event.eventId} aria-label={`${label}, ledger ${event.ledger}`}>
      <div className="event-row__primary">
        <span className="event-row__name">{label}</span>
        <span className="event-row__ledger">Ledger {event.ledger}</span>
      </div>
      <div className="event-row__meta">
        <span>
          <span className="sr-only">Contract: </span>
          {shortenAddress(event.contractAddress)}
        </span>
        <span>
          <span className="sr-only">Received: </span>
          {formatTimestamp(event.receivedAt)}
        </span>
      </div>
      <div className="event-row__details">
        <span>Value: {event.value}</span>
        {event.txHash && (
          <span>
            <span className="sr-only">Transaction: </span>
            Tx: {shortenAddress(event.txHash)}
          </span>
        )}
      </div>
    </article>
  );
});
