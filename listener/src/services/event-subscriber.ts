import * as StellarSDK from '@stellar/stellar-sdk';
import { Config, ContractConfig } from '../types';
import { eventRegistry } from '../store/event-registry';
import { preferenceStore } from '../store/preference-store';
import logger from '../utils/logger';
import { generateRequestId } from '../utils/request-id';
import {
  getEventName,
  matchesEventFilter,
  validateEventPayload,
} from '../utils/event-utils';
import { DiscordNotificationService } from './discord-notification';
import { NotificationRetryQueue } from './notification-retry-queue';

export class EventSubscriber {
  private config: Config;
  private server: StellarSDK.rpc.Server;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private lastCursors: Map<string, string> = new Map();
  private discordService: DiscordNotificationService | null = null;
  private retryQueue: NotificationRetryQueue | null = null;

  constructor(config: Config) {
    this.config = config;
    this.server = new StellarSDK.rpc.Server(config.stellarRpcUrl);
    if (config.discord) {
      this.discordService = new DiscordNotificationService(config.discord);
      this.retryQueue = new NotificationRetryQueue(
        (event, contractConfig, requestId) =>
          this.discordService!.sendEventNotification(event, contractConfig, requestId),
        config.retryQueue
      );
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Event subscriber already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting event subscriber service');
    this.retryQueue?.start();
    this.poll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.retryQueue?.stop();
    logger.info('Stopping event subscriber service');
  }

  private async poll(): Promise<void> {
    while (this.isRunning) {
      const requestId = generateRequestId();
      const pollStart = Date.now();

      try {
        await this.checkForEvents(requestId);
        this.reconnectAttempts = 0;

        logger.info('Poll cycle complete', {
          requestId,
          durationMs: Date.now() - pollStart,
        });

        await this.delay(this.config.pollIntervalMs);
      } catch (error) {
        logger.error('Error polling for events', {
          requestId,
          error,
          durationMs: Date.now() - pollStart,
        });
        await this.handleReconnection(requestId);
      }
    }
  }

  private async checkForEvents(requestId: string = generateRequestId()): Promise<void> {
    const totalContracts = this.config.contractAddresses.length;
    let failureCount = 0;

    for (const contractConfig of this.config.contractAddresses) {
      try {
        const response = await this.getContractEvents(contractConfig);
        const events = response.events || [];
        const processableEvents = events.filter((event) =>
          this.shouldProcessEvent(event, contractConfig, requestId)
        );

        if (events.length > 0) {
          logger.info('Received events', {
            requestId,
            contractAddress: contractConfig.address,
            count: events.length,
            processed: processableEvents.length,
          });
        }

        for (const event of processableEvents) {
          await this.processEvent(event, contractConfig, requestId);
        }

        if (response.cursor) {
          this.lastCursors.set(contractConfig.address, response.cursor);
        }
      } catch (error) {
        failureCount++;
        logger.error('Error fetching events for contract', {
          requestId,
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
    contractConfig: ContractConfig,
    requestId: string = ''
  ): boolean {
    const validation = validateEventPayload(event);
    if (!validation.valid) {
      logger.warn('Skipping invalid event payload', {
        requestId,
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

  private async processEvent(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig,
    requestId: string = ''
  ): Promise<void> {
    const eventStart = Date.now();
    const eventName = getEventName(event.topic);
    const displayEvent = eventRegistry.addFromInput({
      eventId: event.id,
      contractAddress: contractConfig.address,
      eventName,
      ledger: event.ledger,
      type: event.type,
      topic: event.topic,
      value: event.value,
      txHash: event.txHash,
    });

    logger.info('Processing event', {
      requestId,
      contractAddress: displayEvent.contractAddress,
      eventId: displayEvent.eventId,
      eventName: displayEvent.eventName,
      ledger: displayEvent.ledger,
      type: displayEvent.type,
      topic: displayEvent.topic,
      value: displayEvent.value,
    });

    if (this.discordService) {
      const userId = contractConfig.userId ?? 'global';
      if (!preferenceStore.isCategoryEnabled(userId, 'discord')) {
        logger.info('Skipping Discord notification: category disabled by user preferences', {
          eventId: event.id,
          userId,
        });
        return;
      }

      const success = await this.discordService.sendEventNotification(
        event,
        contractConfig,
        requestId
      );
      if (!success && this.retryQueue) {
        logger.warn('Discord notification failed, adding to retry queue', {
          requestId,
          eventId: event.id,
        });
        this.retryQueue.enqueue(event, contractConfig, requestId);
      }
    }

    logger.info('Event processing complete', {
      requestId,
      eventId: event.id,
      durationMs: Date.now() - eventStart,
    });
  }

  private async handleReconnection(requestId?: string): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnection attempts exceeded, stopping service');
      this.stop();
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelayMs * this.reconnectAttempts;
    logger.warn('Attempting to reconnect', {
      requestId,
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });
    await this.delay(delay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
