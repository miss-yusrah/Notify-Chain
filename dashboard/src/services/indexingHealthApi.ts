import type { IndexingHealth } from '../types/indexingHealth';
import { parseIndexingHealth } from '../types/indexingHealth';

export async function fetchIndexingHealth(
  healthUrl: string,
  options?: { signal?: AbortSignal }
): Promise<IndexingHealth> {
  const response = await fetch(healthUrl, { signal: options?.signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch indexing health: ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  return parseIndexingHealth(json);
}

export function resolveIndexingHealthUrl(eventsApiUrl: string): string {
  // Most deployments use `{base}/api/events` for the event feed.
  // Derive the health endpoint from that in a resilient way.
  try {
    const url = new URL(eventsApiUrl);
    url.pathname = '/api/indexing/health';
    url.search = '';
    return url.toString();
  } catch {
    return 'http://localhost:8787/api/indexing/health';
  }
}

