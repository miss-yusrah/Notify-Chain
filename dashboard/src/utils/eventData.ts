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
  eventType: string,
  status: import('../types/event').NotificationStatus = 'all',
  dateFrom = '',
  dateTo = ''
): BlockchainEvent[] {
  const normalizedSearch = search.trim().toLowerCase();
  const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
  // dateTo is inclusive: include the entire day
  const toMs = dateTo ? new Date(dateTo).getTime() + 86_399_999 : Infinity;

  return events.filter((event) => {
    if (contractAddress !== 'all' && event.contractAddress !== contractAddress) return false;
    if (eventType !== 'all' && event.eventName !== eventType) return false;

    if (status === 'read' && !event.read) return false;
    if (status === 'unread' && event.read) return false;

    if (event.receivedAt < fromMs || event.receivedAt > toMs) return false;

    if (!normalizedSearch) return true;

    return (
      event.eventId.toLowerCase().includes(normalizedSearch) ||
      event.eventName?.toLowerCase().includes(normalizedSearch) ||
      event.contractAddress.toLowerCase().includes(normalizedSearch) ||
      event.txHash?.toLowerCase().includes(normalizedSearch)
    );
  });
}
