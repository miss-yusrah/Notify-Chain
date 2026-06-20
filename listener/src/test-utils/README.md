# Test Utilities - Notification Fixture Builder

## Overview

The **NotificationFixtureBuilder** is a centralized, reusable utility for generating test notification payloads. It eliminates duplicate test fixtures and provides a consistent, deterministic way to create test data.

## Features

✅ **Deterministic Output** - No random data, same input = same output  
✅ **Type-Safe** - Full TypeScript support with type checking  
✅ **Flexible** - Builder pattern allows easy customization  
✅ **Comprehensive** - Supports all notification types and scenarios  
✅ **DRY** - Removes duplicate fixtures across test files  
✅ **Chainable** - Fluent API for readable tests  

---

## Installation

No installation required - already included in the project.

Import in your test files:

```typescript
import { NotificationFixtureBuilder } from '../test-utils/notification-fixture-builder';
```

---

## Quick Start

### Basic Usage

```typescript
// Create a simple scheduled notification input
const notification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .build();

// Create a Stellar event
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .build();

// Create a contract config
const config = NotificationFixtureBuilder
  .aContractConfig()
  .build();
```

### With Custom Overrides

```typescript
// Customize specific fields
const notification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withType(NotificationType.EMAIL)
  .withPriority(1)
  .withMaxRetries(5)
  .build();
```

---

## API Reference

### 1. ScheduledNotificationInput Builder

Create `CreateScheduledNotificationInput` objects for API tests.

#### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `withPayload(obj)` | Set custom payload | `.withPayload({ message: 'Custom' })` |
| `withType(type)` | Set notification type | `.withType(NotificationType.EMAIL)` |
| `withTargetRecipient(str)` | Set recipient | `.withTargetRecipient('email@test.com')` |
| `withExecuteAt(date)` | Set execution time | `.withExecuteAt(new Date())` |
| `withMaxRetries(num)` | Set max retries | `.withMaxRetries(5)` |
| `withPriority(num)` | Set priority (1-10) | `.withPriority(1)` |
| `withEventId(str)` | Set event ID | `.withEventId('evt-123')` |
| `withContractAddress(str)` | Set contract address | `.withContractAddress('CA123')` |
| `withMetadata(obj)` | Set metadata | `.withMetadata({ key: 'value' })` |
| `forImmediateExecution()` | Set to past date | `.forImmediateExecution()` |
| `forFutureExecution(ms)` | Set to future date | `.forFutureExecution(3600000)` |

#### Examples

```typescript
// Default Discord notification
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .build();

// Email notification for future
const emailInput = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withType(NotificationType.EMAIL)
  .forFutureExecution(86400000) // 24 hours
  .build();

// High-priority immediate notification
const urgentInput = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withPriority(1)
  .forImmediateExecution()
  .withMaxRetries(10)
  .build();
```

---

### 2. ScheduledNotification Builder

Create full `ScheduledNotification` entities (with database fields).

#### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `withId(num)` | Set notification ID | `.withId(123)` |
| `withStatus(status)` | Set status | `.withStatus(NotificationStatus.COMPLETED)` |
| `withRetryCount(num)` | Set retry count | `.withRetryCount(2)` |
| `withProcessorId(str)` | Set processor ID | `.withProcessorId('worker-1')` |
| `withLockExpiresAt(date)` | Set lock expiration | `.withLockExpiresAt(new Date())` |
| `withLastError(str)` | Set error message | `.withLastError('Network timeout')` |
| `asProcessing(id?)` | Set as processing | `.asProcessing('worker-1')` |
| `asCompleted()` | Set as completed | `.asCompleted()` |
| `asFailed(error?)` | Set as failed | `.asFailed('Connection error')` |

#### Examples

```typescript
// Pending notification
const pending = NotificationFixtureBuilder
  .aScheduledNotification()
  .build();

// Processing notification
const processing = NotificationFixtureBuilder
  .aScheduledNotification()
  .withId(42)
  .asProcessing('worker-xyz')
  .build();

// Failed notification
const failed = NotificationFixtureBuilder
  .aScheduledNotification()
  .withId(99)
  .withRetryCount(3)
  .asFailed('Maximum retries exceeded')
  .build();

// Completed notification
const completed = NotificationFixtureBuilder
  .aScheduledNotification()
  .withId(100)
  .asCompleted()
  .build();
```

---

### 3. StellarEvent Builder

Create Stellar SDK `EventResponse` objects for blockchain event tests.

#### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `withId(str)` | Set event ID | `.withId('evt-001')` |
| `withTopic(arr)` | Set topic array | `.withTopic([xdr.ScVal...])` |
| `withTopicSymbol(str)` | Set topic as symbol | `.withTopicSymbol('transfer')` |
| `withValue(val)` | Set ScVal value | `.withValue(xdr.ScVal...)` |
| `withStringValue(str)` | Set string value | `.withStringValue('Hello')` |
| `withSymbolValue(str)` | Set symbol value | `.withSymbolValue('approve')` |
| `withLedger(num)` | Set ledger number | `.withLedger(1000)` |
| `withTxHash(str)` | Set transaction hash | `.withTxHash('abc123')` |

#### Examples

```typescript
// Basic event
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .build();

// Custom event with specific topic
const transferEvent = NotificationFixtureBuilder
  .aStellarEvent()
  .withId('evt-transfer-001')
  .withTopicSymbol('token_transfer')
  .withStringValue('1000 XLM')
  .build();

// Event with long string value (for truncation tests)
const longEvent = NotificationFixtureBuilder
  .aStellarEvent()
  .withStringValue('a'.repeat(600))
  .build();
```

---

### 4. ContractConfig Builder

Create contract configuration objects.

#### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `withAddress(str)` | Set contract address | `.withAddress('CA123')` |
| `withEvents(arr)` | Set event filter array | `.withEvents(['transfer', 'mint'])` |
| `withSingleEvent(str)` | Set single event filter | `.withSingleEvent('transfer')` |

#### Examples

```typescript
// Default config (all events)
const config = NotificationFixtureBuilder
  .aContractConfig()
  .build();

// Specific events
const transferConfig = NotificationFixtureBuilder
  .aContractConfig()
  .withAddress('CA_CUSTOM_ADDRESS')
  .withEvents(['transfer', 'approve'])
  .build();

// Single event
const mintConfig = NotificationFixtureBuilder
  .aContractConfig()
  .withSingleEvent('mint')
  .build();
```

---

### 5. ExecutionLog Builder

Create `NotificationExecutionLog` objects for audit trail tests.

#### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `withScheduledNotificationId(num)` | Set notification ID | `.withScheduledNotificationId(42)` |
| `withAttempt(num)` | Set attempt number | `.withAttempt(3)` |
| `withStatus(status)` | Set status | `.withStatus('FAILED')` |
| `withError(str)` | Set error (auto FAILED) | `.withError('Timeout')` |
| `withDuration(ms)` | Set duration | `.withDuration(250)` |

#### Examples

```typescript
// Successful execution
const successLog = NotificationFixtureBuilder
  .anExecutionLog()
  .withScheduledNotificationId(1)
  .withAttempt(1)
  .withStatus('SUCCESS')
  .withDuration(150)
  .build();

// Failed execution
const failedLog = NotificationFixtureBuilder
  .anExecutionLog()
  .withScheduledNotificationId(1)
  .withAttempt(2)
  .withError('Network timeout')
  .withDuration(5000)
  .build();
```

---

## Deterministic Behavior

### Why Deterministic?

Tests must be **repeatable**. Random data causes flaky tests that pass sometimes and fail other times.

### How It Works

The fixture builder uses:
- **Fixed epoch**: `2024-01-01T00:00:00Z`
- **Deterministic IDs**: Sequential, predictable IDs
- **No random elements**: No `Math.random()` or unseeded UUIDs

### Date Generation

```typescript
// Always returns 2024-01-01T00:00:00Z
NotificationFixtureBuilder.dates.now();

// Always returns 2024-01-01T01:00:00Z (1 hour after epoch)
NotificationFixtureBuilder.dates.future(3600000);

// Always returns 2023-12-31T23:00:00Z (1 hour before epoch)
NotificationFixtureBuilder.dates.past(3600000);
```

### Test Constants

```typescript
// Access deterministic constants
const constants = NotificationFixtureBuilder.constants;

console.log(constants.contractAddress); // "CAAA...WHF"
console.log(constants.eventId); // "test-event-00000001"
console.log(constants.webhookUrl); // "https://discord.com/..."
console.log(constants.processorId); // "test-processor-uuid-0001"
```

---

## Payload Templates

Pre-configured payload templates for all notification types:

```typescript
const templates = NotificationFixtureBuilder.payloads;

// Discord template
templates.discord;
// {
//   content: 'Test Discord notification',
//   embeds: [...]
// }

// Email template
templates.email;
// {
//   subject: 'Test Email Notification',
//   body: '...',
//   from: 'test@example.com'
// }

// Webhook template
templates.webhook;

// SMS template
templates.sms;
```

---

## Advanced Usage

### Chaining Multiple Modifications

```typescript
const notification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withType(NotificationType.EMAIL)
  .withTargetRecipient('test@example.com')
  .withPriority(1)
  .withMaxRetries(10)
  .forImmediateExecution()
  .withMetadata({ campaignId: 'test-campaign' })
  .build();
```

### Creating Test Scenarios

```typescript
// Scenario: Overdue notification
const overdueNotification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .forImmediateExecution() // Past date
  .build();

// Scenario: High-priority, immediate
const urgentNotification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withPriority(1)
  .forImmediateExecution()
  .withMaxRetries(10)
  .build();

// Scenario: Future scheduled
const futureNotification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .forFutureExecution(86400000) // 24 hours
  .build();
```

### Creating Arrays of Fixtures

```typescript
// Create multiple notifications
const notifications = [1, 2, 3, 4, 5].map(id =>
  NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .withPriority(id)
    .build()
);

// Create different notification types
const allTypes = [
  NotificationType.DISCORD,
  NotificationType.EMAIL,
  NotificationType.WEBHOOK,
  NotificationType.SMS,
].map(type =>
  NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .withType(type)
    .build()
);
```

---

## Migration Guide

### Before (Duplicate Fixtures)

```typescript
// ❌ Old way - duplicate hardcoded fixtures
test('should create notification', async () => {
  const input = {
    payload: { message: 'Test' },
    notificationType: NotificationType.DISCORD,
    targetRecipient: 'test-webhook',
    executeAt: new Date(Date.now() + 60000),
    maxRetries: 3,
    priority: 5,
  };
  
  const id = await repository.create(input);
  expect(id).toBeGreaterThan(0);
});
```

### After (Fixture Builder)

```typescript
// ✅ New way - reusable builder
test('should create notification', async () => {
  const input = NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .build();
  
  const id = await repository.create(input);
  expect(id).toBeGreaterThan(0);
});
```

---

## Best Practices

### DO ✅

- Use builders for all test fixtures
- Chain modifications for readability
- Use deterministic dates
- Customize only what's necessary for the test

```typescript
// Good
const notification = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withPriority(1)
  .build();
```

### DON'T ❌

- Don't create fixtures manually
- Don't use `Math.random()` or `Date.now()`
- Don't hardcode webhook URLs or IDs

```typescript
// Bad
const notification = {
  payload: { message: 'Test' },
  executeAt: new Date(Date.now() + Math.random() * 1000), // Non-deterministic!
  targetRecipient: 'random-webhook-' + Math.random(),
  ...
};
```

---

## Type Safety

The builder is fully type-safe and enforces your notification interfaces:

```typescript
// ✅ Type-safe - compiler catches errors
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withType(NotificationType.DISCORD) // Enum checked
  .build(); // Returns CreateScheduledNotificationInput

// ❌ Compile error
const bad = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withType('invalid'); // Type error!
```

---

## Testing the Fixture Builder

The fixture builder itself has tests:

```bash
npm test test-utils/notification-fixture-builder.test.ts
```

---

## Examples by Test Scenario

### Repository Tests

```typescript
// Create notification
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .build();

// Lock pending notifications
const overdue = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .forImmediateExecution()
  .build();

// Failed notification with retries
const failed = NotificationFixtureBuilder
  .aScheduledNotification()
  .withRetryCount(3)
  .asFailed('Test error')
  .build();
```

### Discord Notification Tests

```typescript
// Basic event
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .build();

const config = NotificationFixtureBuilder
  .aContractConfig()
  .build();

await discordService.sendEventNotification(event, config);
```

### Retry Queue Tests

```typescript
// Event for retry
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .withId('evt-retry-001')
  .build();

const config = NotificationFixtureBuilder
  .aContractConfig()
  .build();

queue.enqueue(event, config);
```

---

## Summary

The **NotificationFixtureBuilder** provides:

✅ Single source of truth for test data  
✅ Deterministic, repeatable tests  
✅ Type-safe with full TypeScript support  
✅ Flexible builder pattern  
✅ DRY - no duplicate fixtures  
✅ Comprehensive coverage of all notification types  

**Result**: Cleaner, more maintainable tests with less boilerplate.

---

## Support

For issues or questions:
- Check examples in this README
- Review refactored test files
- See inline JSDoc comments in the builder
