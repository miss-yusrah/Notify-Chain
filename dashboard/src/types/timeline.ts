export type TimelineStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRY';

export interface TimelineEntry {
  attempt: number;
  status: TimelineStatus;
  executionTime: string; // ISO string
  errorMessage?: string | null;
  durationMs?: number | null;
}

export interface NotificationTimeline {
  notificationId: number;
  status: TimelineStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  nextRetryAt?: string | null;
  lastError?: string | null;
  entries: TimelineEntry[];
}
