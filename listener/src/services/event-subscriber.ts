import * as StellarSDK from '@stellar/stellar-sdk';
import { Config, ContractConfig } from '../types';
import logger from '../utils/logger';
import {
  getEventName,
  matchesEventFilter,
  validateEventPayload,
} from '../utils/event-utils';

export class EventSubscriber {
  private config: Config;
  private server: StellarSDK.rpc.Server;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private lastCursors: Map<string, string> = new Map();

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
    const totalContracts = this.config.contractAddresses.length;
    let failureCount = 0;

    for (const contractConfig of this.config.contractAddresses) {
      try {
        const response = await this.getContractEvents(contractConfig);
        const events = response.events || [];
        const processableEvents = events.filter((event) =>
          this.shouldProcessEvent(event, contractConfig)
        );

        if (events.length > 0) {
          logger.info('Received events', {
            contractAddress: contractConfig.address,
            count: events.length,
            processed: processableEvents.length,
          });
        }

        for (const event of processableEvents) {
          this.processEvent(event, contractConfig);
        }

        if (response.cursor) {
          this.lastCursors.set(contractConfig.address, response.cursor);
        }
      } catch (error) {
        failureCount++;
        logger.error('Error fetching events for contract', {
          contractAddress: contractConfig.address,
          error,
        });
      }
    }

    if (totalContracts > 0 && failureCount === totalContracts) {
      throw new Error(
        `Failed to fetch events for all ${totalContracts} configured contract(s)`
      );
    }
  }

  private shouldProcessEvent(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig
  ): boolean {
    const validation = validateEventPayload(event);
    if (!validation.valid) {
      logger.warn('Skipping invalid event payload', {
        contractAddress: contractConfig.address,
        eventId: event.id,
        reason: validation.reason,
      });
      return false;
    }

    const eventName = getEventName(event.topic);
    if (!matchesEventFilter(eventName, contractConfig.events)) {
      return false;
    }

    return true;
  }

  private async getContractEvents(
    contractConfig: ContractConfig
  ): Promise<StellarSDK.rpc.Api.GetEventsResponse> {
    const lastCursor = this.lastCursors.get(contractConfig.address);
    const request: StellarSDK.rpc.Api.GetEventsRequest = lastCursor
      ? {
          filters: [
            {
              contractIds: [contractConfig.address],
              type: 'contract',
            },
          ],
          cursor: lastCursor,
          limit: 100,
        }
      : {
          filters: [
            {
              contractIds: [contractConfig.address],
              type: 'contract',
            },
          ],
          startLedger: 1,
          limit: 100,
        };

    return await this.server.getEvents(request);
  }

  private processEvent(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig
  ): void {
    logger.info('Processing event', {
      contractAddress: contractConfig.address,
      eventName: getEventName(event.topic),
      ledger: event.ledger,
      type: event.type,
      topic: event.topic,
      value: event.value,
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
    logger.warn('Attempting to reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });
    await this.delay(delay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
