import * as StellarSDK from '@stellar/stellar-sdk';
import { Config, ContractConfig } from '../types';
import logger from '../utils/logger';

export class EventSubscriber {
  private config: Config;
  private server: StellarSDK.rpc.Server;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private lastCursor?: string;

  constructor(config: Config) {
    this.config = config;
    this.server = new StellarSDK.rpc.Server(config.stellarRpcUrl);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('Starting event subscriber service');
    this.poll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Stopping event subscriber service');
  }

  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkForEvents();
        this.reconnectAttempts = 0;
        await this.delay(this.config.pollIntervalMs);
      } catch (error) {
        logger.error('Error polling for events', { error });
        await this.handleReconnection();
      }
    }
  }

  private async checkForEvents(): Promise<void> {
    for (const contractConfig of this.config.contractAddresses) {
      try {
        const response = await this.getContractEvents(contractConfig);
        const events = response.events || [];
        if (events.length > 0) {
          logger.info('Received events', { contractAddress: contractConfig.address, count: events.length });
          for (const event of events) {
            this.processEvent(event, contractConfig);
          }
          this.lastCursor = response.cursor;
        }
      } catch (error) {
        logger.error('Error fetching events for contract', { contractAddress: contractConfig.address, error });
      }
    }
  }

  private async getContractEvents(contractConfig: ContractConfig): Promise<StellarSDK.rpc.Api.GetEventsResponse> {
    const request: StellarSDK.rpc.Api.GetEventsRequest = this.lastCursor
      ? {
        filters: [
          {
            contractIds: [contractConfig.address],
            type: 'contract'
          }
        ],
        cursor: this.lastCursor,
        limit: 100
      }
      : {
        filters: [
          {
            contractIds: [contractConfig.address],
            type: 'contract'
          }
        ],
        startLedger: 1,
        limit: 100
      };

    return await this.server.getEvents(request);
  }

  private processEvent(event: StellarSDK.rpc.Api.EventResponse, contractConfig: ContractConfig): void {
    logger.info('Processing event', {
      contractAddress: contractConfig.address,
      ledger: event.ledger,
      type: event.type,
      topic: event.topic,
      value: event.value
    });
  }

  private async handleReconnection(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnection attempts exceeded, stopping service');
      this.stop();
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelayMs * this.reconnectAttempts;
    logger.warn('Attempting to reconnect', { attempt: this.reconnectAttempts, delayMs: delay });
    await this.delay(delay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
