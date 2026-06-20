# Fixture Builder - Quick Reference

## Import

```typescript
import { NotificationFixtureBuilder } from '../test-utils/notification-fixture-builder';
```

---

## Quick Start

```typescript
// Scheduled notification input
const input = NotificationFixtureBuilder.aScheduledNotificationInput().build();

// Stellar event
const event = NotificationFixtureBuilder.aStellarEvent().build();

// Contract config
const config = NotificationFixtureBuilder.aContractConfig().build();
```

---

## Common Methods

### Notification Input

```typescript
NotificationFixtureBuilder.aScheduledNotificationInput()
  .withType(NotificationType.EMAIL)           // Change type
  .withPriority(1)                            // Set priority (1-10)
  .withMaxRetries(5)                          // Set retry count
  .forImmediateExecution()                    // Past date
  .forFutureExecution(3600000)                // Future date (1 hour)
  .withPayload({ custom: 'data' })            // Custom payload
  .build();
```

### Notification Entity

```typescript
NotificationFixtureBuilder.aScheduledNotification()
  .withId(123)                                // Set ID
  .withStatus(NotificationStatus.PENDING)     // Set status
  .withRetryCount(2)                          // Set retry count
  .asProcessing('worker-1')                   // Set as processing
  .asCompleted()                              // Set as completed
  .asFailed('Error message')                  // Set as failed
  .build();
```

### Stellar Event

```typescript
NotificationFixtureBuilder.aStellarEvent()
  .withId('evt-001')                          // Set event ID
  .withTopicSymbol('transfer')                // Set topic
  .withStringValue('1000 XLM')                // Set string value
  .withSymbolValue('approve')                 // Set symbol value
  .withLedger(5000)                           // Set ledger
  .build();
```

### Contract Config

```typescript
NotificationFixtureBuilder.aContractConfig()
  .withAddress('CONTRACT-A')                  // Set address
  .withEvents(['transfer', 'mint'])           // Multiple events
  .withSingleEvent('burn')                    // Single event
  .build();
```

---

## Deterministic Values

```typescript
// Dates
NotificationFixtureBuilder.dates.now()        // 2024-01-01T00:00:00Z
NotificationFixtureBuilder.dates.future(ms)   // Epoch + offset
NotificationFixtureBuilder.dates.past(ms)     // Epoch - offset

// Constants
NotificationFixtureBuilder.constants.webhookUrl
NotificationFixtureBuilder.constants.eventId
NotificationFixtureBuilder.constants.contractAddress
NotificationFixtureBuilder.constants.processorId

// Templates
NotificationFixtureBuilder.payloads.discord
NotificationFixtureBuilder.payloads.email
NotificationFixtureBuilder.payloads.webhook
NotificationFixtureBuilder.payloads.sms
```

---

## Common Patterns

### Create Multiple

```typescript
const inputs = [1, 2, 3].map(priority =>
  NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .withPriority(priority)
    .build()
);
```

### Different Types

```typescript
const types = [
  NotificationType.DISCORD,
  NotificationType.EMAIL,
  NotificationType.WEBHOOK,
];

const inputs = types.map(type =>
  NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .withType(type)
    .build()
);
```

### Different States

```typescript
const pending = NotificationFixtureBuilder
  .aScheduledNotification()
  .build();

const processing = NotificationFixtureBuilder
  .aScheduledNotification()
  .asProcessing()
  .build();

const completed = NotificationFixtureBuilder
  .aScheduledNotification()
  .asCompleted()
  .build();

const failed = NotificationFixtureBuilder
  .aScheduledNotification()
  .asFailed('Error')
  .build();
```

---

## Migration Examples

### Before ❌

```typescript
const input = {
  payload: { message: 'Test' },
  notificationType: NotificationType.DISCORD,
  targetRecipient: 'webhook',
  executeAt: new Date(Date.now() + 60000),
  maxRetries: 3,
  priority: 5,
};
```

### After ✅

```typescript
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .build();
```

---

## All Builders

| Builder | Method | Purpose |
|---------|--------|---------|
| Input | `.aScheduledNotificationInput()` | API input objects |
| Entity | `.aScheduledNotification()` | Full entities with DB fields |
| Event | `.aStellarEvent()` | Blockchain events |
| Config | `.aContractConfig()` | Contract configurations |
| Log | `.anExecutionLog()` | Audit logs |

---

## Documentation

- **Full API**: `src/test-utils/README.md`
- **Migration**: `TEST-FIXTURE-MIGRATION-GUIDE.md`
- **Summary**: `TEST-FIXTURE-IMPLEMENTATION-SUMMARY.md`
- **Examples**: See refactored test files

---

## Tips

✅ Always call `.build()` at the end  
✅ Use deterministic dates  
✅ Chain only what you need to customize  
✅ Use constants for consistent values  
✅ Check IntelliSense for available methods  

❌ Don't use `Date.now()` or `Math.random()`  
❌ Don't create fixtures manually  
❌ Don't duplicate builder code  

---

**Ready to use!** 🚀
