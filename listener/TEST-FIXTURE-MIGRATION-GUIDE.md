# Test Fixture Migration Guide

## Overview

This guide helps you migrate from hardcoded, duplicate test fixtures to the centralized **NotificationFixtureBuilder** utility.

---

## Why Migrate?

### Problems with Old Approach ❌

```typescript
// Duplicate fixture in test file 1
const input = {
  payload: { message: 'Test notification' },
  notificationType: NotificationType.DISCORD,
  targetRecipient: 'test-webhook',
  executeAt: new Date(Date.now() + 60000),
  maxRetries: 3,
  priority: 5,
};

// Same fixture duplicated in test file 2
const input = {
  payload: { message: 'Test notification' },
  notificationType: NotificationType.DISCORD,
  targetRecipient: 'test-webhook',
  executeAt: new Date(Date.now() + 60000),  // Non-deterministic!
  maxRetries: 3,
  priority: 5,
};
```

**Issues:**
- 🔴 **Duplication**: Same fixture repeated across files
- 🔴 **Non-deterministic**: `Date.now()` causes flaky tests
- 🔴 **Maintenance**: Changes require updating multiple files
- 🔴 **Verbosity**: 8 lines for simple fixture

### Benefits of New Approach ✅

```typescript
// Single line, deterministic, reusable
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .build();
```

**Benefits:**
- ✅ **DRY**: Single source of truth
- ✅ **Deterministic**: Same output every time
- ✅ **Maintainable**: Update in one place
- ✅ **Concise**: 1-3 lines instead of 8+
- ✅ **Type-safe**: Full TypeScript support
- ✅ **Flexible**: Easy customization via builder pattern

---

## Migration Steps

### Step 1: Import the Fixture Builder

```typescript
// Add this import to your test file
import { NotificationFixtureBuilder } from '../test-utils/notification-fixture-builder';
```

### Step 2: Identify Duplicate Fixtures

Look for patterns like:

```typescript
// ❌ Hardcoded fixture to migrate
const mockEvent = {
  id: 'event-123',
  type: 'contract',
  ledger: 1000,
  ledgerClosedAt: '2026-01-01T00:00:00Z',
  // ... many more fields
};
```

### Step 3: Replace with Builder

```typescript
// ✅ Migrated to fixture builder
const mockEvent = NotificationFixtureBuilder
  .aStellarEvent()
  .build();
```

### Step 4: Customize Only What's Needed

```typescript
// ✅ Override specific fields
const customEvent = NotificationFixtureBuilder
  .aStellarEvent()
  .withId('custom-event-123')
  .withTopicSymbol('transfer')
  .build();
```

---

## Migration Examples

### Example 1: Scheduled Notification Input

#### Before ❌
```typescript
test('should create notification', async () => {
  const input = {
    payload: { message: 'Test notification' },
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

#### After ✅
```typescript
test('should create notification', async () => {
  const input = NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .build();

  const id = await repository.create(input);
  expect(id).toBeGreaterThan(0);
});
```

**Improvement**: 8 lines → 3 lines, deterministic dates

---

### Example 2: Stellar Event

#### Before ❌
```typescript
function createMockEvent(overrides = {}) {
  return {
    id: 'event-123',
    type: 'contract',
    ledger: 1000,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
    transactionIndex: 1,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: 'abc123',
    topic: [xdr.ScVal.scvSymbol('test_event')],
    value: xdr.ScVal.scvString('test value'),
    ...overrides,
  };
}
```

#### After ✅
```typescript
// No need for helper function!
// Just use the builder directly:
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .build();

// Or with overrides:
const customEvent = NotificationFixtureBuilder
  .aStellarEvent()
  .withTopicSymbol('transfer')
  .withStringValue('1000 XLM')
  .build();
```

**Improvement**: No more helper function, better type safety

---

### Example 3: Contract Config

#### Before ❌
```typescript
const mockContractConfig = {
  address: 'CA123456789ABCDEF',
  events: ['autoshare_created'],
};
```

#### After ✅
```typescript
const mockContractConfig = NotificationFixtureBuilder
  .aContractConfig()
  .withSingleEvent('autoshare_created')
  .build();
```

**Improvement**: Deterministic address, consistent structure

---

### Example 4: Multiple Test Scenarios

#### Before ❌
```typescript
test('should handle immediate execution', async () => {
  const input = {
    payload: { message: 'Test' },
    notificationType: NotificationType.DISCORD,
    targetRecipient: 'test-webhook',
    executeAt: new Date(Date.now() - 1000), // Past
    maxRetries: 3,
    priority: 5,
  };
  // ...
});

test('should handle future execution', async () => {
  const input = {
    payload: { message: 'Test' },
    notificationType: NotificationType.DISCORD,
    targetRecipient: 'test-webhook',
    executeAt: new Date(Date.now() + 60000), // Future
    maxRetries: 3,
    priority: 5,
  };
  // ...
});
```

#### After ✅
```typescript
test('should handle immediate execution', async () => {
  const input = NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .forImmediateExecution()
    .build();
  // ...
});

test('should handle future execution', async () => {
  const input = NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .forFutureExecution()
    .build();
  // ...
});
```

**Improvement**: Intent is clear, less duplication

---

## Common Patterns

### Pattern 1: Multiple Fixtures with Variations

#### Before ❌
```typescript
const input1 = { ...baseInput, priority: 1 };
const input2 = { ...baseInput, priority: 2 };
const input3 = { ...baseInput, priority: 3 };
```

#### After ✅
```typescript
const inputs = [1, 2, 3].map(priority =>
  NotificationFixtureBuilder
    .aScheduledNotificationInput()
    .withPriority(priority)
    .build()
);
```

---

### Pattern 2: Complex Event Setup

#### Before ❌
```typescript
const event = createMockEvent({
  id: 'evt-001',
  topic: [xdr.ScVal.scvSymbol('transfer')],
  value: xdr.ScVal.scvString('1000 tokens'),
});
```

#### After ✅
```typescript
const event = NotificationFixtureBuilder
  .aStellarEvent()
  .withId('evt-001')
  .withTopicSymbol('transfer')
  .withStringValue('1000 tokens')
  .build();
```

---

### Pattern 3: Different Notification Types

#### Before ❌
```typescript
const discordInput = { ...baseInput, notificationType: NotificationType.DISCORD };
const emailInput = { ...baseInput, notificationType: NotificationType.EMAIL };
const webhookInput = { ...baseInput, notificationType: NotificationType.WEBHOOK };
```

#### After ✅
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

---

## Migration Checklist

### For Each Test File:

- [ ] Import NotificationFixtureBuilder
- [ ] Identify all hardcoded fixtures
- [ ] Replace with appropriate builder method
- [ ] Remove helper functions if no longer needed
- [ ] Replace `Date.now()` with deterministic dates
- [ ] Replace random/seeded data with deterministic values
- [ ] Test that all tests still pass
- [ ] Verify tests are deterministic (run multiple times)

---

## File-by-File Migration

### Priority 1: Core Test Files

1. ✅ `notification-scheduler.test.ts` → `notification-scheduler-refactored.test.ts`
2. ✅ `discord-notification.test.ts` → `discord-notification-refactored.test.ts`
3. ✅ `notification-retry-queue.test.ts` → `notification-retry-queue-refactored.test.ts`

### Priority 2: Integration Tests

4. `integration.test.ts`
5. `multi-channel-delivery.e2e.test.ts`

### Priority 3: Other Tests

6. `event-subscriber.test.ts`
7. `notification-deduplicator.test.ts`
8. `event-registry.test.ts`

---

## Deterministic Replacements

### Replace Non-Deterministic Code

| Old (Non-Deterministic) | New (Deterministic) |
|-------------------------|---------------------|
| `new Date(Date.now() + 60000)` | `NotificationFixtureBuilder.dates.future(60000)` |
| `new Date(Date.now() - 1000)` | `NotificationFixtureBuilder.dates.past(1000)` |
| `'event-' + Math.random()` | `NotificationFixtureBuilder.aStellarEvent().withId('evt-001')` |
| `uuidv4()` | `NotificationFixtureBuilder.constants.processorId` |
| Hardcoded webhook URL | `NotificationFixtureBuilder.constants.webhookUrl` |

---

## Testing the Migration

After migrating a test file:

### 1. Run Tests Multiple Times
```bash
# Should pass every time with identical output
npm test -- <test-file> --testPathIgnorePatterns=[] --no-coverage
npm test -- <test-file> --testPathIgnorePatterns=[] --no-coverage
npm test -- <test-file> --testPathIgnorePatterns=[] --no-coverage
```

### 2. Check for Non-Determinism
```bash
# Run 10 times in a row
for i in {1..10}; do npm test -- <test-file>; done
```

### 3. Verify Type Safety
```bash
# TypeScript should compile without errors
npm run build
```

---

## Common Pitfalls

### ❌ Pitfall 1: Forgetting to Call `.build()`

```typescript
// Wrong - returns builder, not object
const input = NotificationFixtureBuilder.aScheduledNotificationInput();

// Right - returns object
const input = NotificationFixtureBuilder.aScheduledNotificationInput().build();
```

### ❌ Pitfall 2: Still Using `Date.now()`

```typescript
// Wrong - still non-deterministic
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .withExecuteAt(new Date(Date.now() + 1000))
  .build();

// Right - deterministic
const input = NotificationFixtureBuilder
  .aScheduledNotificationInput()
  .forFutureExecution(1000)
  .build();
```

### ❌ Pitfall 3: Not Using Deterministic Constants

```typescript
// Wrong - hardcoded, inconsistent
const config = NotificationFixtureBuilder
  .aContractConfig()
  .withAddress('MY-CUSTOM-ADDRESS')
  .build();

// Right - unless you need a specific address, use default
const config = NotificationFixtureBuilder
  .aContractConfig()
  .build(); // Uses deterministic address
```

---

## Benefits After Migration

### Before Migration
- 🔴 500+ lines of duplicate fixture code
- 🔴 10+ helper functions
- 🔴 Non-deterministic tests (flaky)
- 🔴 Maintenance overhead

### After Migration
- ✅ 50 lines in fixture builder (10x reduction)
- ✅ 1 centralized utility
- ✅ Deterministic tests (reliable)
- ✅ Easy maintenance

---

## Support

For migration help:
- Review refactored test files for examples
- Check [test-utils/README.md](./src/test-utils/README.md) for full API reference
- See inline JSDoc comments in fixture builder
- Run fixture builder tests: `npm test notification-fixture-builder.test.ts`

---

## Summary

**Migration Formula:**

1. **Import** NotificationFixtureBuilder
2. **Identify** duplicate fixtures
3. **Replace** with builder
4. **Customize** only what's needed
5. **Test** for determinism

**Result:** Cleaner, more maintainable tests with less boilerplate! 🎉
