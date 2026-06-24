import type { BlockchainEvent } from '../types/event';

export function generateMockEvents(count: number): BlockchainEvent[] {
  const eventNames = [
    'TaskCreated',
    'WorkSubmitted',
    'SubmissionApproved',
    'SubmissionRejected',
    'TaskCancelled',
    'DisputeRaised',
    'AutoshareCreated',
    'Withdrawal',
  ];
  const contracts = [
    'CCEMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5',
    'CBDFMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5',
  ];

  return Array.from({ length: count }, (_, index) => {
    const eventName = eventNames[index % eventNames.length];
    return {
      eventId: `event-${index}`,
      contractAddress: contracts[index % contracts.length],
      eventName,
      ledger: 100000 + index,
      type: 'contract',
      topic: [eventName],
      value: String(index % 1000),
      txHash: `tx-${index.toString(16).padStart(8, '0')}`,
      receivedAt: Date.now() - index * 1000,
    };
  });
}

export function filterEvents(
  events: BlockchainEvent[],
  search: string,
  contractAddress: string,
  eventType: string
): BlockchainEvent[] {
  const normalizedSearch = search.trim().toLowerCase();

  return events.filter((event) => {
    if (contractAddress !== 'all' && event.contractAddress !== contractAddress) {
      return false;
    }

    if (eventType !== 'all' && event.eventName !== eventType) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return (
      event.eventId.toLowerCase().includes(normalizedSearch) ||
      event.eventName?.toLowerCase().includes(normalizedSearch) ||
      event.contractAddress.toLowerCase().includes(normalizedSearch) ||
      event.txHash?.toLowerCase().includes(normalizedSearch)
    );
  });
}
