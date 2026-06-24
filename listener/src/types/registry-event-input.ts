import * as StellarSDK from '@stellar/stellar-sdk';

export interface RegistryEventInput {
  eventId: string;
  contractAddress: string;
  eventName: string | null;
  ledger: number;
  type: string;
  topic: StellarSDK.xdr.ScVal[];
  value: StellarSDK.xdr.ScVal;
  txHash?: string;
}
