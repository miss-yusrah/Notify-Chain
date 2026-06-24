import * as StellarSDK from '@stellar/stellar-sdk';

export interface EventValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateEventPayload(
  event: StellarSDK.rpc.Api.EventResponse
): EventValidationResult {
  if (!event.id || typeof event.id !== 'string') {
    return { valid: false, reason: 'Missing or invalid event id' };
  }
  if (!event.type || typeof event.type !== 'string') {
    return { valid: false, reason: 'Missing or invalid event type' };
  }
  if (typeof event.ledger !== 'number' || event.ledger < 0) {
    return { valid: false, reason: 'Missing or invalid ledger' };
  }
  if (!Array.isArray(event.topic)) {
    return { valid: false, reason: 'Missing or invalid topic' };
  }
  if (event.value === undefined || event.value === null) {
    return { valid: false, reason: 'Missing event value' };
  }
  return { valid: true };
}

export function getEventName(topic: StellarSDK.xdr.ScVal[]): string | null {
  if (!topic || topic.length === 0) {
    return null;
  }

  for (const entry of topic) {
    const name = scValToString(entry);
    if (name) {
      return name;
    }
  }

  return null;
}

export function matchesEventFilter(
  eventName: string | null,
  allowedEvents: string[]
): boolean {
  if (!allowedEvents || allowedEvents.length === 0 || allowedEvents.includes('*')) {
    return true;
  }

  if (!eventName) {
    return false;
  }

  return allowedEvents.includes(eventName);
}

function scValToString(val: StellarSDK.xdr.ScVal): string | null {
  switch (val.switch()) {
    case StellarSDK.xdr.ScValType.scvSymbol():
      return val.sym().toString();
    case StellarSDK.xdr.ScValType.scvString():
      return val.str().toString();
    default:
      return null;
  }
}
