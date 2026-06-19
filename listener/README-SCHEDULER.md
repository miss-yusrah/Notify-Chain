# Scheduled Notification System

## Overview

This system provides a robust, reliable scheduled notification system that enables users to schedule notifications for future delivery. The system features:

- **Persistent Storage**: SQLite database for reliable notification storage
- **Distributed Locking**: Prevents race conditions in multi-instance deployments
- **Automatic Recovery**: Catches up on missed notifications after downtime
- **Retry Logic**: Exponential backoff retry mechanism with configurable limits
- **Precise Timing**: Notifications delivered within configurable buffer (default ±1 minute)
- **Fault Tolerant**: Graceful failure handling without blocking the queue

## Architecture

### Components

1. **Database Layer** (`src/database/`)
   - `database.ts`: SQLite connection and query interface
   - `schema.sql`: Database schema with indexes and triggers

2. **Repository Layer** (`src/services/scheduled-notification-repository.ts`)
   - CRUD operations for scheduled notifications
   - Distributed locking with atomic updates
   - Stale lock recovery
   - Statistics and reporting

3. **Scheduler Service** (`src/services/notification-scheduler.ts`)
   - Background worker that polls for due notifications
   - Processes notifications in batches
   - Handles retries and failures
   - Supports graceful shutdown

4. **API Layer** (`src/services/notification-api.ts`)
   - High-level interface for scheduling notifications
   - Validation and error handling
   - Convenience methods for different notification types

### Database Schema

#### `scheduled_notifications` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `payload` | TEXT | JSON payload of notification |
| `notification_type` | VARCHAR(50) | Type: 'discord', 'email', 'webhook', etc. |
| `target_recipient` | TEXT | Recipient identifier |
| `execute_at` | DATETIME | Scheduled execution time |
| `status` | VARCHAR(20) | PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED |
| `retry_count` | INTEGER | Current retry attempt |
| `max_retries` | INTEGER | Maximum retry attempts |
| `processing_started_at` | DATETIME | When processing began |
| `processing_completed_at` | DATETIME | When processing finished |
| `processor_id` | VARCHAR(100) | Worker instance identifier |
| `lock_expires_at` | DATETIME | Distributed lock expiration |
| `last_error` | TEXT | Last error message |
| `error_details` | TEXT | Full error context (JSON) |
| `event_id` | TEXT | Reference to original event |
| `contract_address` | TEXT | Stellar contract address |
| `priority` | INTEGER | Priority (1-10, lower = higher) |
| `metadata` | TEXT | Additional metadata (JSON) |

#### `notification_execution_log` Table

Tracks all execution attempts for auditing and debugging.

## Installation

### 1. Install Dependencies

```bash
cd listener
npm install
```

This will install:
- `sqlite3`: SQLite database driver
- `uuid`: For generating unique processor IDs

### 2. Run Database Migration

```bash
npm run migrate
```

This creates the database schema at `./data/notifications.db` (or path specified in `DATABASE_PATH`).

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Enable scheduler
SCHEDULER_ENABLED=true

# Database path
DATABASE_PATH=./data/notifications.db

# Poll interval (how often to check for due notifications)
SCHEDULER_POLL_INTERVAL_MS=10000

# Lock timeout (how long a worker can hold a lock)
SCHEDULER_LOCK_TIMEOUT_MS=60000

# Batch size (how many notifications to process per cycle)
SCHEDULER_BATCH_SIZE=10

# Timing buffer (allow notifications to be processed within this buffer)
SCHEDULER_TIMING_BUFFER_MS=60000

# Processor ID (leave empty for auto-generated UUID)
SCHEDULER_PROCESSOR_ID=
```

## Usage

### Starting the Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Scheduling Notifications

#### Via API Service

```typescript
import { NotificationAPI } from './services/notification-api';
import { NotificationType } from './types/scheduled-notification';

// Initialize API
const api = new NotificationAPI(repository);

// Schedule a notification
const notificationId = await api.scheduleNotification({
  payload: {
    event: { /* event data */ },
    contractConfig: { /* contract config */ }
  },
  notificationType: NotificationType.DISCORD,
  targetRecipient: 'webhook-url',
  executeAt: new Date('2024-12-31T12:00:00Z'),
  maxRetries: 3,
  priority: 5
});

// Schedule Discord notification (convenience method)
const id = await api.scheduleDiscordNotification(
  'https://discord.com/api/webhooks/...',
  { content: 'Scheduled notification!' },
  new Date(Date.now() + 3600000), // 1 hour from now
  { maxRetries: 5, priority: 1 }
);

// Cancel a notification
await api.cancelNotification(notificationId);

// Get notification status
const notification = await api.getNotification(notificationId);

// Get statistics
const stats = await api.getStatistics();
console.log(stats); // { pending: 10, processing: 2, completed: 100, failed: 5 }
```

## How It Works

### 1. Scheduling Flow

```
User/System
    ↓
NotificationAPI.scheduleNotification()
    ↓
Repository.create()
    ↓
Database (status: PENDING)
```

### 2. Processing Flow

```
Scheduler (every POLL_INTERVAL_MS)
    ↓
Repository.recoverStaleLocks() ← Clean up crashed workers
    ↓
Repository.fetchAndLockPendingNotifications()
    ↓
Atomic UPDATE (status → PROCESSING, set lock)
    ↓
For each notification:
    ↓
Execute notification delivery
    ↓
Success? → markAsCompleted()
    ↓
Failure? → markAsFailedOrRetry()
```

### 3. Race Condition Prevention

The system uses **pessimistic locking** with atomic updates:

```sql
-- Step 1: Atomically lock notifications
UPDATE scheduled_notifications
SET status = 'PROCESSING',
    processor_id = 'worker-123',
    lock_expires_at = NOW() + 60 seconds
WHERE id IN (
  SELECT id FROM scheduled_notifications
  WHERE status = 'PENDING' AND execute_at <= NOW()
  LIMIT 10
)

-- Step 2: Only this worker can fetch these locked notifications
SELECT * FROM scheduled_notifications
WHERE processor_id = 'worker-123'
  AND status = 'PROCESSING'
```

### 4. Stale Lock Recovery

If a worker crashes, its locks will expire:

```sql
-- Recover locks where lock_expires_at < NOW()
UPDATE scheduled_notifications
SET status = 'PENDING',
    processor_id = NULL,
    lock_expires_at = NULL
WHERE status = 'PROCESSING'
  AND lock_expires_at < NOW()
```

### 5. Retry Logic

Failed notifications are automatically retried:

- **Retry Count < Max Retries**: Status set back to PENDING
- **Retry Count ≥ Max Retries**: Status set to FAILED
- Error details logged in `last_error` and `error_details`

## Multi-Instance Deployment

The scheduler supports running multiple instances:

1. Each instance gets a unique `processor_id` (UUID)
2. Distributed locks prevent duplicate processing
3. Stale lock recovery handles crashed instances
4. Set different `SCHEDULER_PROCESSOR_ID` for each instance (optional)

## Monitoring

### Statistics Endpoint

```typescript
const stats = await notificationAPI.getStatistics();
// {
//   pending: 50,
//   processing: 5,
//   completed: 1000,
//   failed: 10,
//   overdue: 3
// }
```

### Execution Log

All execution attempts are logged in `notification_execution_log`:

```sql
SELECT * FROM notification_execution_log
WHERE scheduled_notification_id = 123
ORDER BY execution_time DESC;
```

### Application Logs

The scheduler logs all important events:

```typescript
logger.info('Processing scheduled notification', {
  id: 123,
  type: 'discord',
  executeAt: '2024-12-31T12:00:00Z',
  attempt: 2
});
```

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- Repository operations
- Distributed locking
- Race condition prevention
- Stale lock recovery
- Retry logic
- API validation

## Performance Considerations

### Indexes

The schema includes optimized indexes:

```sql
-- Most important index for polling
CREATE INDEX idx_scheduled_notifications_status_execute_at 
  ON scheduled_notifications(status, execute_at) 
  WHERE status = 'PENDING';

-- For stale lock recovery
CREATE INDEX idx_scheduled_notifications_lock_expires 
  ON scheduled_notifications(lock_expires_at, status) 
  WHERE status = 'PROCESSING';
```

### Batch Processing

- Default batch size: 10 notifications per cycle
- Adjust `SCHEDULER_BATCH_SIZE` based on load
- Higher batch size = more throughput, but longer lock times

### Poll Interval

- Default: 10 seconds
- Shorter interval = more precise timing, more CPU usage
- Longer interval = less CPU, less precise timing

## Troubleshooting

### Notifications Not Processing

1. Check if scheduler is enabled:
   ```bash
   grep SCHEDULER_ENABLED .env
   ```

2. Check database connection:
   ```bash
   sqlite3 ./data/notifications.db "SELECT COUNT(*) FROM scheduled_notifications;"
   ```

3. Check logs for errors:
   ```bash
   tail -f logs/app.log | grep scheduler
   ```

### Stale Locks

Stale locks are automatically recovered, but you can manually check:

```sql
SELECT * FROM scheduled_notifications
WHERE status = 'PROCESSING'
  AND lock_expires_at < datetime('now');
```

### Failed Notifications

Check failed notifications and error details:

```sql
SELECT id, target_recipient, retry_count, last_error
FROM scheduled_notifications
WHERE status = 'FAILED'
ORDER BY updated_at DESC
LIMIT 10;
```

## Future Enhancements

Potential improvements:

1. **Additional Notification Types**: Email, SMS, Push notifications
2. **Web UI**: Dashboard for managing scheduled notifications
3. **Webhooks**: Generic webhook delivery support
4. **Bulk Operations**: Schedule multiple notifications at once
5. **Advanced Scheduling**: Recurring notifications, cron-like syntax
6. **Priority Queues**: Separate queues for different priorities
7. **Dead Letter Queue**: Store permanently failed notifications
8. **Metrics**: Prometheus metrics for monitoring

## License

Same as parent project.
