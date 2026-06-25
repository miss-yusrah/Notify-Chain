export interface BlockchainEvent {
  eventId: string;
  contractAddress: string;
  eventName: string | null;
  ledger: number;
  type: string;
  topic: string[];
  value: string;
  txHash?: string;
  receivedAt: number;
  /** Whether the user has seen/read this notification. Default: false */
  read?: boolean;
}

export type NotificationStatus = 'all' | 'read' | 'unread';

export interface EventFilters {
  search: string;
  contractAddress: string;
  eventType: string;
  status: NotificationStatus;
  dateFrom: string; // ISO date string "YYYY-MM-DD" or ""
  dateTo: string;   // ISO date string "YYYY-MM-DD" or ""
}
