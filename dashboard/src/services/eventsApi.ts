import type { BlockchainEvent } from '../types/event';

export interface ContractStatus {
  address: string;
  paused: boolean;
  error?: string;
}

export interface StatusResponse {
  timestamp: string;
  contracts: ContractStatus[];
}

export async function fetchEvents(apiUrl: string): Promise<BlockchainEvent[]> {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.status}`);
  }

  const payload = (await response.json()) as { events?: BlockchainEvent[] };
  return payload.events ?? [];
}

export async function fetchStatus(apiUrl: string): Promise<StatusResponse> {
  const response = await fetch(`${apiUrl}/api/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch status: ${response.status}`);
  }
  return response.json() as Promise<StatusResponse>;
}
