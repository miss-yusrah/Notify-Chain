/**
 * Tests for NotificationFixtureBuilder
 * 
 * Ensures the fixture builder itself works correctly and provides
 * deterministic, type-safe output.
 */

import { NotificationFixtureBuilder } from './notification-fixture-builder';
import { NotificationType, NotificationStatus } from '../types/scheduled-notification';

describe('NotificationFixtureBuilder', () => {
  describe('Deterministic Behavior', () => {
    it('should produce identical output for same input', () => {
      const fixture1 = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .build();

      const fixture2 = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .build();

      // Deep equality check
      expect(fixture1).toEqual(fixture2);
      expect(fixture1.executeAt.getTime()).toBe(fixture2.executeAt.getTime());
    });

    it('should use fixed epoch for dates', () => {
      const now = NotificationFixtureBuilder.dates.now();
      const expectedEpoch = new Date('2024-01-01T00:00:00Z');

      expect(now.getTime()).toBe(expectedEpoch.getTime());
    });

    it('should produce consistent event IDs', () => {
      const event1 = NotificationFixtureBuilder.aStellarEvent().build();
      const event2 = NotificationFixtureBuilder.aStellarEvent().build();

      expect(event1.id).toBe(event2.id);
      expect(event1.id).toBe('test-event-00000001');
    });

    it('should use deterministic constants', () => {
      const constants = NotificationFixtureBuilder.constants;

      expect(constants.eventId).toBe('test-event-00000001');
      expect(constants.webhookUrl).toContain('discord.com');
      expect(constants.contractAddress).toMatch(/^C[A-Z0-9]+$/);
    });
  });

  describe('ScheduledNotificationInputBuilder', () => {
    it('should create valid default input', () => {
      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .build();

      expect(input.payload).toBeDefined();
      expect(input.notificationType).toBe(NotificationType.DISCORD);
      expect(input.targetRecipient).toBeDefined();
      expect(input.executeAt).toBeInstanceOf(Date);
      expect(input.maxRetries).toBe(3);
      expect(input.priority).toBe(5);
    });

    it('should allow custom payload', () => {
      const customPayload = { custom: 'data', value: 123 };
      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .withPayload(customPayload)
        .build();

      expect(input.payload).toEqual(customPayload);
    });

    it('should change payload template when type changes', () => {
      const emailInput = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .withType(NotificationType.EMAIL)
        .build();

      expect(emailInput.notificationType).toBe(NotificationType.EMAIL);
      expect(emailInput.payload).toHaveProperty('subject');
      expect(emailInput.payload).toHaveProperty('from');
    });

    it('should support all notification types', () => {
      const types = [
        NotificationType.DISCORD,
        NotificationType.EMAIL,
        NotificationType.WEBHOOK,
        NotificationType.SMS,
      ];

      types.forEach(type => {
        const input = NotificationFixtureBuilder
          .aScheduledNotificationInput()
          .withType(type)
          .build();

        expect(input.notificationType).toBe(type);
      });
    });

    it('should set immediate execution (past date)', () => {
      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .forImmediateExecution()
        .build();

      const now = new Date();
      expect(input.executeAt.getTime()).toBeLessThan(now.getTime());
    });

    it('should set future execution', () => {
      const oneHour = 3600000;
      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .forFutureExecution(oneHour)
        .build();

      const epoch = new Date('2024-01-01T00:00:00Z');
      const expected = new Date(epoch.getTime() + oneHour);
      expect(input.executeAt.getTime()).toBe(expected.getTime());
    });

    it('should chain multiple modifications', () => {
      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .withType(NotificationType.EMAIL)
        .withPriority(1)
        .withMaxRetries(10)
        .withEventId('custom-event-id')
        .withContractAddress('CUSTOM-CONTRACT')
        .withMetadata({ key: 'value' })
        .build();

      expect(input.notificationType).toBe(NotificationType.EMAIL);
      expect(input.priority).toBe(1);
      expect(input.maxRetries).toBe(10);
      expect(input.eventId).toBe('custom-event-id');
      expect(input.contractAddress).toBe('CUSTOM-CONTRACT');
      expect(input.metadata).toEqual({ key: 'value' });
    });
  });

  describe('ScheduledNotificationBuilder', () => {
    it('should create valid default notification', () => {
      const notification = NotificationFixtureBuilder
        .aScheduledNotification()
        .build();

      expect(notification.id).toBe(1);
      expect(notification.status).toBe(NotificationStatus.PENDING);
      expect(notification.retryCount).toBe(0);
      expect(notification.maxRetries).toBe(3);
      expect(notification.priority).toBe(5);
      expect(notification.payload).toBeDefined();
    });

    it('should set as processing with lock', () => {
      const notification = NotificationFixtureBuilder
        .aScheduledNotification()
        .asProcessing('worker-123')
        .build();

      expect(notification.status).toBe(NotificationStatus.PROCESSING);
      expect(notification.processorId).toBe('worker-123');
      expect(notification.lockExpiresAt).toBeDefined();
      expect(notification.processingStartedAt).toBeDefined();
    });

    it('should set as completed', () => {
      const notification = NotificationFixtureBuilder
        .aScheduledNotification()
        .asCompleted()
        .build();

      expect(notification.status).toBe(NotificationStatus.COMPLETED);
      expect(notification.processingCompletedAt).toBeDefined();
      expect(notification.processorId).toBeNull();
      expect(notification.lockExpiresAt).toBeNull();
    });

    it('should set as failed with error', () => {
      const errorMessage = 'Network timeout';
      const notification = NotificationFixtureBuilder
        .aScheduledNotification()
        .asFailed(errorMessage)
        .build();

      expect(notification.status).toBe(NotificationStatus.FAILED);
      expect(notification.lastError).toBe(errorMessage);
      expect(notification.errorDetails).toContain(errorMessage);
      expect(notification.processingCompletedAt).toBeDefined();
    });

    it('should allow custom retry count', () => {
      const notification = NotificationFixtureBuilder
        .aScheduledNotification()
        .withRetryCount(5)
        .build();

      expect(notification.retryCount).toBe(5);
    });
  });

  describe('StellarEventBuilder', () => {
    it('should create valid default event', () => {
      const event = NotificationFixtureBuilder
        .aStellarEvent()
        .build();

      expect(event.id).toBe('test-event-00000001');
      expect(event.type).toBe('contract');
      expect(event.ledger).toBe(1000);
      expect(event.txHash).toBeDefined();
      expect(event.topic).toBeDefined();
      expect(event.value).toBeDefined();
    });

    it('should set custom string value', () => {
      const event = NotificationFixtureBuilder
        .aStellarEvent()
        .withStringValue('Hello World')
        .build();

      // Value is an xdr.ScVal, check it's properly formatted
      expect(event.value).toBeDefined();
    });

    it('should set custom symbol value', () => {
      const event = NotificationFixtureBuilder
        .aStellarEvent()
        .withSymbolValue('transfer')
        .build();

      expect(event.value).toBeDefined();
    });

    it('should set custom topic symbol', () => {
      const event = NotificationFixtureBuilder
        .aStellarEvent()
        .withTopicSymbol('mint')
        .build();

      expect(event.topic).toBeDefined();
      expect(event.topic.length).toBe(1);
    });

    it('should allow chaining modifications', () => {
      const event = NotificationFixtureBuilder
        .aStellarEvent()
        .withId('custom-event-id')
        .withLedger(5000)
        .withTxHash('custom-hash')
        .withTopicSymbol('burn')
        .withStringValue('1000 tokens')
        .build();

      expect(event.id).toBe('custom-event-id');
      expect(event.ledger).toBe(5000);
      expect(event.txHash).toBe('custom-hash');
    });
  });

  describe('ContractConfigBuilder', () => {
    it('should create valid default config', () => {
      const config = NotificationFixtureBuilder
        .aContractConfig()
        .build();

      expect(config.address).toBeDefined();
      expect(config.events).toEqual(['*']);
    });

    it('should set custom address', () => {
      const config = NotificationFixtureBuilder
        .aContractConfig()
        .withAddress('CUSTOM-ADDRESS')
        .build();

      expect(config.address).toBe('CUSTOM-ADDRESS');
    });

    it('should set multiple events', () => {
      const events = ['transfer', 'mint', 'burn'];
      const config = NotificationFixtureBuilder
        .aContractConfig()
        .withEvents(events)
        .build();

      expect(config.events).toEqual(events);
    });

    it('should set single event', () => {
      const config = NotificationFixtureBuilder
        .aContractConfig()
        .withSingleEvent('approve')
        .build();

      expect(config.events).toEqual(['approve']);
    });
  });

  describe('ExecutionLogBuilder', () => {
    it('should create valid default log', () => {
      const log = NotificationFixtureBuilder
        .anExecutionLog()
        .build();

      expect(log.id).toBe(1);
      expect(log.scheduledNotificationId).toBe(1);
      expect(log.executionAttempt).toBe(1);
      expect(log.status).toBe('SUCCESS');
      expect(log.executionTime).toBeInstanceOf(Date);
      expect(log.durationMs).toBe(150);
    });

    it('should create failed log with error', () => {
      const log = NotificationFixtureBuilder
        .anExecutionLog()
        .withError('Connection timeout')
        .build();

      expect(log.status).toBe('FAILED');
      expect(log.errorMessage).toBe('Connection timeout');
    });

    it('should set custom attempt and duration', () => {
      const log = NotificationFixtureBuilder
        .anExecutionLog()
        .withAttempt(3)
        .withDuration(5000)
        .build();

      expect(log.executionAttempt).toBe(3);
      expect(log.durationMs).toBe(5000);
    });

    it('should set status', () => {
      const retryLog = NotificationFixtureBuilder
        .anExecutionLog()
        .withStatus('RETRY')
        .build();

      expect(retryLog.status).toBe('RETRY');
    });
  });

  describe('Type Safety', () => {
    it('should enforce TypeScript types', () => {
      // This test validates that the builder enforces types at compile time
      // If this compiles, the type safety is working

      const input = NotificationFixtureBuilder
        .aScheduledNotificationInput()
        .withType(NotificationType.EMAIL) // Enum must be valid
        .withPriority(5) // Must be number
        .build();

      expect(input).toBeDefined();
    });
  });

  describe('Payload Templates', () => {
    it('should provide Discord template', () => {
      const template = NotificationFixtureBuilder.payloads.discord;

      expect(template.content).toBeDefined();
      expect(template.embeds).toBeDefined();
    });

    it('should provide Email template', () => {
      const template = NotificationFixtureBuilder.payloads.email;

      expect(template.subject).toBeDefined();
      expect(template.body).toBeDefined();
      expect(template.from).toBeDefined();
      expect(template.to).toBeDefined();
    });

    it('should provide Webhook template', () => {
      const template = NotificationFixtureBuilder.payloads.webhook;

      expect(template.event).toBeDefined();
      expect(template.data).toBeDefined();
    });

    it('should provide SMS template', () => {
      const template = NotificationFixtureBuilder.payloads.sms;

      expect(template.message).toBeDefined();
      expect(template.phoneNumber).toBeDefined();
    });
  });

  describe('Date Generator', () => {
    it('should generate consistent now date', () => {
      const now1 = NotificationFixtureBuilder.dates.now();
      const now2 = NotificationFixtureBuilder.dates.now();

      expect(now1.getTime()).toBe(now2.getTime());
    });

    it('should generate future date with offset', () => {
      const future = NotificationFixtureBuilder.dates.future(3600000);
      const now = NotificationFixtureBuilder.dates.now();

      expect(future.getTime()).toBe(now.getTime() + 3600000);
    });

    it('should generate past date with offset', () => {
      const past = NotificationFixtureBuilder.dates.past(3600000);
      const now = NotificationFixtureBuilder.dates.now();

      expect(past.getTime()).toBe(now.getTime() - 3600000);
    });
  });
});
