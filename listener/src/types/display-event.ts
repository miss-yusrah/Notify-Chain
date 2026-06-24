export interface DisplayEvent {
  eventId: string;
  contractAddress: string;
  eventName: string | null;
  ledger: number;
  type: string;
  topic: string[];
  value: string;
  txHash?: string;
  receivedAt: number;
}
