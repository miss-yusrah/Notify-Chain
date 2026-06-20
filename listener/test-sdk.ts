import * as StellarSDK from '@stellar/stellar-sdk';
import logger from './src/utils/logger';

logger.info('StellarSDK.rpc keys', { keys: Object.keys(StellarSDK.rpc) });
logger.info('StellarSDK.rpc.Server methods', {
  methods: Object.getOwnPropertyNames(StellarSDK.rpc.Server.prototype),
});
