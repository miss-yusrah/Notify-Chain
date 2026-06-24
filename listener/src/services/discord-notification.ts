import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../utils/logger';
import { ContractConfig, DiscordConfig } from '../types';
import { getEventName } from '../utils/event-utils';
import { NotificationDeduplicator, generateFingerprint } from './notification-deduplicator';
import { getNotificationAnalyticsAggregator, NotificationAnalyticsAggregator } from './notification-analytics-aggregator';
import { NotificationType } from '../types/scheduled-notification';

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  footer?: { text: string };
}

export function createDiscordService(config: DiscordConfig): DiscordNotificationService {
  return new DiscordNotificationService(config);
}

export class DiscordNotificationService {
  private config: DiscordConfig;
  private deduplicator: NotificationDeduplicator;
  private timeoutCount: number = 0;
  private readonly analytics: NotificationAnalyticsAggregator | null;

  constructor(config: DiscordConfig, deduplicator?: NotificationDeduplicator) {
    this.config = config;
    this.deduplicator =
      deduplicator ??
      new NotificationDeduplicator({
        windowMs: config.deduplicationWindowMs,
        maxSize: config.deduplicationMaxSize,
      });
    this.analytics = getNotificationAnalyticsAggregator();
  }

  async sendEventNotification(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig,
    requestId?: string
  ): Promise<boolean> {
    const fingerprint = generateFingerprint(event.id, contractConfig.address);

    if (this.deduplicator.isDuplicate(fingerprint)) {
      this.analytics?.record({
        notificationType: NotificationType.DISCORD,
        contractAddress: contractConfig.address,
        outcome: 'skipped',
        durationMs: 0,
        timestamp: Date.now(),
      });
      logger.info('Skipping duplicate notification', {
        eventId: event.id,
        contractAddress: contractConfig.address,
        fingerprint,
        deduplication: this.deduplicator.getMetrics(),
      });
      return true;
    }
    const logContext = {
      requestId,
      eventId: event.id,
      contractAddress: contractConfig.address,
      webhookId: this.config.webhookId,
    };

    logger.info('Sending Discord notification', logContext);

    const message = this.formatEventMessage(event, contractConfig);
    const startTime = Date.now();

    try {
      const response = await this.sendWebhook(message);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        this.analytics?.record({
          notificationType: NotificationType.DISCORD,
          contractAddress: contractConfig.address,
          outcome: 'failure',
          durationMs,
          errorReason: `HTTP ${response.status}`,
          timestamp: Date.now(),
        });
        logger.error('Discord webhook failed', {
          ...logContext,
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          durationMs,
        });
        return false;
      }

      this.deduplicator.markSent(fingerprint);
      this.analytics?.record({
        notificationType: NotificationType.DISCORD,
        contractAddress: contractConfig.address,
        outcome: 'success',
        durationMs,
        timestamp: Date.now(),
      });
      logger.info('Discord notification delivered', {
        ...logContext,
        durationMs,
        deduplication: this.deduplicator.getMetrics(),
      });
      return true;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.analytics?.record({
        notificationType: NotificationType.DISCORD,
        contractAddress: contractConfig.address,
        outcome: 'failure',
        durationMs,
        errorReason: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
      logger.error('Error sending Discord notification', {
        ...logContext,
        error,
        durationMs: Date.now() - startTime,
      });
      return false;
    }
  }

  getMetrics() {
    return {
      ...this.deduplicator.getMetrics(),
      timeoutCount: this.timeoutCount,
    };
  }

  getDeduplicationMetrics() {
    return this.deduplicator.getMetrics();
  }

  async sendTestMessage(requestId?: string): Promise<boolean> {
    const message: DiscordMessage = {
      embeds: [
        {
          title: '✅ Test Notification',
          description: 'Discord webhook is working correctly!',
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    logger.info('Sending Discord test message', {
      requestId,
      webhookId: this.config.webhookId,
    });

    const startTime = Date.now();

    try {
      const response = await this.sendWebhook(message);
      const durationMs = Date.now() - startTime;

      logger.info('Discord test message delivered', {
        requestId,
        webhookId: this.config.webhookId,
        ok: response.ok,
        durationMs,
      });

      return response.ok;
    } catch (error) {
      logger.error('Error sending test message', {
        requestId,
        error,
        durationMs: Date.now() - startTime,
      });
      return false;
    }
  }

  private async sendWebhook(message: DiscordMessage): Promise<Response> {
    const timeoutMs = this.config.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: controller.signal as any,
      });
      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.timeoutCount++;
        logger.error('Discord webhook request timed out', {
          webhookId: this.config.webhookId,
          timeoutMs,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private formatEventMessage(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig
  ): DiscordMessage {
    const eventName = getEventName(event.topic) ?? 'Unknown Event';
    const embed = this.createEventEmbed(event, contractConfig, eventName);

    return {
      embeds: [embed],
    };
  }

  private createEventEmbed(
    event: StellarSDK.rpc.Api.EventResponse,
    contractConfig: ContractConfig,
    eventName: string
  ): DiscordEmbed {
    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: 'Contract',
        value: this.formatAddress(contractConfig.address),
        inline: true,
      },
      {
        name: 'Ledger',
        value: String(event.ledger),
        inline: true,
      },
      {
        name: 'Type',
        value: event.type,
        inline: true,
      },
    ];

    if (event.value) {
      fields.push({
        name: 'Value',
        value: this.formatValue(event.value),
        inline: false,
      });
    }

    return {
      title: `📡 Event: ${eventName}`,
      color: this.getEventColor(event.type),
      timestamp: new Date().toISOString(),
      fields,
    };
  }

  private getEventColor(eventType: string): number {
    const colors: Record<string, number> = {
      system: 0x0099ff,
      contract: 0x00ff00,
      transaction: 0xffaa00,
    };
    return colors[eventType] || 0x808080;
  }

  private formatAddress(address: string): string {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  }

  private formatValue(value: StellarSDK.xdr.ScVal): string {
    try {
      switch (value.switch()) {
        case StellarSDK.xdr.ScValType.scvVoid():
          return '_No data_';
        case StellarSDK.xdr.ScValType.scvU64():
          return String(value.u64());
        case StellarSDK.xdr.ScValType.scvI64():
          return String(value.i64());
        case StellarSDK.xdr.ScValType.scvString(): {
          const strVal = value.str().toString();
          return strVal.length > 500 ? strVal.slice(0, 500) + '...' : strVal;
        }
        case StellarSDK.xdr.ScValType.scvSymbol():
          return `🔹 ${value.sym().toString()}`;
        case StellarSDK.xdr.ScValType.scvAddress():
          return this.formatAddress(value.address().toString());
        default:
          return JSON.stringify(value).slice(0, 500);
      }
    } catch {
      return String(value);
    }
  }
}

