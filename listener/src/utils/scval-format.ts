import * as StellarSDK from '@stellar/stellar-sdk';

function formatScVal(val: StellarSDK.xdr.ScVal): string {
  try {
    const native = StellarSDK.scValToNative(val);
    if (typeof native === 'string') {
      return native;
    }
    return JSON.stringify(native);
  } catch {
    return val.toXDR('base64');
  }
}

export function formatScValArray(vals: StellarSDK.xdr.ScVal[]): string[] {
  return vals.map((val) => formatScVal(val));
}

export function formatScValValue(val: StellarSDK.xdr.ScVal): string {
  return formatScVal(val);
}
