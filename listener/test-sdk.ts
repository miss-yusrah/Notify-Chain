import * as StellarSDK from '@stellar/stellar-sdk';
console.log("StellarSDK.rpc keys:", Object.keys(StellarSDK.rpc));
console.log("\nStellarSDK.rpc.Server methods:", Object.getOwnPropertyNames(StellarSDK.rpc.Server.prototype));

