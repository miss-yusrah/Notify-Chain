import { EventSubscriber } from './event-subscriber';
import { Config } from '../types';

describe('EventSubscriber', () => {
  const testConfig: Config = {
    stellarNetwork: 'testnet',
    stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
    contractAddresses: [
      {
        address: 'CCEMX6Q5V5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5F5',
        events: ['*']
      }
    ],
    pollIntervalMs: 30000,
    maxReconnectAttempts: 5,
    reconnectDelayMs: 100
  };

  it('should create an instance', () => {
    const subscriber = new EventSubscriber(testConfig);
    expect(subscriber).toBeDefined();
  });

  it('should start and stop without errors', async () => {
    const subscriber = new EventSubscriber(testConfig);
    await subscriber.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    await subscriber.stop();
  });
});
