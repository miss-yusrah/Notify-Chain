import type { NotificationTimeline } from '../types/timeline';

const BASE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_EVENTS_API_URL) ||
  'http://localhost:8787';

export async function fetchTimeline(notificationId: number): Promise<NotificationTimeline> {
  const res = await fetch(`${BASE_URL}/api/notifications/${notificationId}/timeline`);
  if (!res.ok) throw new Error(`Failed to fetch timeline: ${res.status}`);
  return res.json() as Promise<NotificationTimeline>;
}
