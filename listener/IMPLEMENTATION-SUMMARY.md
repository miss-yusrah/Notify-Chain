# Scheduled Notification System - Implementation Summary

## Overview

A complete, production-ready scheduled notification system has been implemented for the Notify-Chain listener service. The system enables scheduling notifications for future delivery with robust reliability, fault tolerance, and race condition prevention.

## ✅ Acceptance Criteria Met

### 1. **Precise Timing** ✓
- Notifications are sent within ±1 minute buffer (configurable via `SCHEDULER_TIMING_BUFFER_MS`)
- Scheduler polls every 10 seconds by default (configurable via `SCHEDULER_POLL_INTERVAL_MS`)
- Priority-based ordering ensures high-priority notifications are processed first

### 2. **Resilience & Fault Tolerance** ✓
- **Automatic Recovery**: On service restart, scheduler automatically resumes processing
- **Stale Lock Recovery**: Crashed worker locks are automatically recovered
- **Catch-up Logic**: Missed notifications from downtime are processed immediately on recovery
- **Persistent Storage**: SQLite database ensures no data loss on restart

### 3. **Idempotency & Race Condition Prevention** ✓
- **Distributed Locking**: Atomic row-level locking with `processor_id` and `lock_expires_at`
- **Multi-Instance Support**: Multiple workers can run simultaneously without conflicts
- **Optimistic Concurrency**: Each worker gets unique locks via atomic UPDATE...WHERE
- **Lock Expiration**: Automatic timeout prevents indefinite locks

### 4. **Graceful Failure** ✓
- Failed notifications marked as `FAILED` status
- Full error context logged in `error_details` (JSON)
- Retry logic with configurable max retries (default: 3)
- Failed jobs don't block the queue - processing continues
- Execution history tracked in `notification_execution_log` table

---

## 📁 Files Created

### Core Implementation
1. **`src/database/database.ts`** - SQLite connection and query interface
2. **`src/database/schema.sql`** - Database schema with tables, indexes, triggers
3. **`src/types/scheduled-notification.ts`** - TypeScript types and interfaces
4. **`src/services/scheduled-notification-repository.ts`** - Data access layer
5. **`src/services/notification-scheduler.ts`** - Background worker scheduler
6. **`src/services/notification-api.ts`** - High-level scheduling API

### Integration & Configuration
7. **`src/scripts/migrate-db.ts`** - Database migration script
8. **`src/index.ts`** (updated) - Integrated scheduler into main service
9. **`src/config.ts`** (updated) - Added scheduler configuration
10. **`src/types/index.ts`** (updated) - Added SchedulerConfig interface
11. **`src/api/events-server.ts`** (updated) - Added REST API endpoints

### Testing & Examples
12. **`src/tests/notification-scheduler.test.ts`** - Comprehensive test suite
13. **`src/examples/schedule-notification-example.ts`** - Usage examples

### Documentation
14. **`README-SCHEDULER.md`** - Comprehensive system documentation
15. **`INSTALLATION.md`** - Installation and setup guide
16. **`.env.example`** (updated) - Configuration template
17. **`package.json`** (updated) - Added dependencies and npm scripts

---

## 🗄️ Database Schema

### `scheduled_notifications` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER PRIMARY KEY | Unique identifier |
| `payload` | TEXT (JSON) | Notification content |
| `notification_type` | VARCHAR(50) | Type: discord, email, webhook, sms |
| `target_recipient` | TEXT | Recipient identifier |
| `execute_at` | DATETIME | Scheduled execution time |
| `status` | VARCHAR(20) | PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED |
| `retry_count` | INTEGER | Current retry attempt (0-based) |
| `max_retries` | INTEGER | Maximum retry attempts |
| `processor_id` | VARCHAR(100) | Worker instance holding lock |
| `lock_expires_at` | DATETIME | Lock expiration timestamp |
| `last_error` | TEXT | Error message from last failure |
| `error_details` | TEXT (JSON) | Full error context |
| `priority` | INTEGER | 1-10 (lower = higher priority) |
| `metadata` | TEXT (JSON) | Additional metadata |

**Key Indexes:**
- `idx_scheduled_notifications_status_execute_at`: Fast pending notification queries
- `idx_scheduled_notifications_lock_expires`: Stale lock recovery
- `idx_scheduled_notifications_event_id`: Event reference lookups

### `notification_execution_log` Table

Audit log for all execution attempts:
- `scheduled_notification_id` (FK)
- `execution_attempt`
- `status` (SUCCESS, FAILED, RETRY)
- `error_message`
- `duration_ms`

---

## 🔧 Configuration

Add to `.env`:

```bash
# Enable scheduler
SCHEDULER_ENABLED=true

# Database location
DATABASE_PATH=./data/notifications.db

# Poll interval (10 seconds)
SCHEDULER_POLL_INTERVAL_MS=10000

# Lock timeout (60 seconds)
SCHEDULER_LOCK_TIMEOUT_MS=60000

# Batch size (10 per cycle)
SCHEDULER_BATCH_SIZE=10

# Timing buffer (±1 minute)
SCHEDULER_TIMING_BUFFER_MS=60000

# Processor ID (auto-generated if empty)
SCHEDULER_PROCESSOR_ID=
```

---

## 🚀 Usage

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Run database migration
npm run migrate

# 3. Start service
npm run dev
```

### Schedule a Notification

```typescript
import { NotificationAPI } from './services/notification-api';
import { NotificationType } from './types/scheduled-notification';

// Initialize API
const api = new NotificationAPI(repository);

// Schedule Discord notification for 1 hour from now
const id = await api.scheduleDiscordNotification(
  'https://discord.com/webhook/...',
  { content: 'Hello World!' },
  new Date(Date.now() + 3600000),
  { maxRetries: 5, priority: 1 }
);

// Check status
const notification = await api.getNotification(id);

// Get statistics
const stats = await api.getStatistics();
// { pending: 10, processing: 2, completed: 100, failed: 5 }
```

### REST API Endpoints

```bash
# Schedule notification
POST /api/schedule
Content-Type: application/json

{
  "payload": {"message": "Test"},
  "notificationType": "discord",
  "targetRecipient": "webhook-url",
  "executeAt": "2024-12-31T12:00:00Z",
  "priority": 5
}

# Get notification by ID
GET /api/schedule/:id

# Get statistics
GET /api/schedule/stats
```

---

## 🔐 Race Condition Prevention

### How It Works

1. **Atomic Lock Acquisition**
   ```sql
   UPDATE scheduled_notifications
   SET status = 'PROCESSING',
       processor_id = 'worker-123',
       lock_expires_at = NOW() + 60s
   WHERE id IN (
     SELECT id FROM scheduled_notifications
     WHERE status = 'PENDING' AND execute_at <= NOW()
     LIMIT 10
   )
   ```

2. **Unique Processor IDs**
   - Each worker instance has a unique UUID
   - Only notifications locked by this processor are fetched

3. **Lock Expiration**
   - Locks automatically expire after `SCHEDULER_LOCK_TIMEOUT_MS`
   - Stale locks recovered on next poll cycle

4. **Multi-Instance Safe**
   - Multiple workers can run simultaneously
   - No duplicate processing due to atomic updates

---

## 🔄 Catch-Up Logic

When the service restarts after downtime:

1. **Scheduler starts** → Calls `recoverStaleLocks()`
2. **Stale locks released** → Status reset to PENDING
3. **Overdue notifications** → Fetched by `execute_at <= NOW()`
4. **Processed immediately** → No missed notifications

Example:
- Server down from 10:00 AM - 11:00 AM
- Notification scheduled for 10:30 AM
- Server starts at 11:00 AM
- Notification processed within 10 seconds (next poll cycle)

---

## 🧪 Testing

### Run Tests

```bash
npm test
```

### Test Coverage

- ✅ Repository CRUD operations
- ✅ Distributed locking
- ✅ Race condition prevention (concurrent workers)
- ✅ Stale lock recovery
- ✅ Retry logic (success and max retries)
- ✅ Notification cancellation
- ✅ Statistics reporting
- ✅ API validation

---

## 📊 Monitoring

### Application Logs

```typescript
// Processing started
logger.info('Processing scheduled notification', {
  id: 123,
  type: 'discord',
  executeAt: '2024-12-31T12:00:00Z',
  attempt: 2
});

// Success
logger.info('Notification delivered successfully', {
  id: 123,
  type: 'discord',
  duration: 150
});

// Failure
logger.error('Failed to process notification', {
  id: 123,
  error: 'Webhook timeout',
  attempt: 2
});
```

### Database Queries

```sql
-- Pending notifications
SELECT COUNT(*) FROM scheduled_notifications WHERE status = 'PENDING';

-- Overdue notifications
SELECT * FROM scheduled_notifications 
WHERE status = 'PENDING' AND execute_at < datetime('now');

-- Failed notifications
SELECT id, last_error, retry_count FROM scheduled_notifications 
WHERE status = 'FAILED' 
ORDER BY updated_at DESC LIMIT 10;

-- Execution history
SELECT * FROM notification_execution_log 
WHERE scheduled_notification_id = 123 
ORDER BY execution_time;
```

---

## 🎯 Key Features

### ✅ Implemented
- [x] SQLite persistent storage
- [x] Background scheduler with polling
- [x] Distributed locking (multi-instance safe)
- [x] Automatic stale lock recovery
- [x] Retry logic with exponential backoff
- [x] Priority-based processing
- [x] Execution audit logging
- [x] REST API endpoints
- [x] Comprehensive test suite
- [x] Discord notification support
- [x] Graceful shutdown
- [x] Configuration via environment variables

### 🔮 Future Enhancements
- [ ] Email notification support
- [ ] SMS notification support
- [ ] Generic webhook support
- [ ] Recurring/cron-based schedules
- [ ] Web UI dashboard
- [ ] Prometheus metrics
- [ ] Bulk scheduling operations
- [ ] Dead letter queue for permanent failures

---

## 📦 Dependencies Added

```json
{
  "dependencies": {
    "sqlite3": "^5.1.7",    // SQLite database driver
    "uuid": "^9.0.1"        // Unique processor ID generation
  },
  "devDependencies": {
    "@types/uuid": "^9.0.8" // TypeScript types for uuid
  }
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                     │
│  (index.ts - Service initialization & orchestration)    │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┴──────────────┐
        │                              │
        ▼                              ▼
┌──────────────┐            ┌──────────────────────┐
│   REST API   │            │  Notification        │
│ (events-     │            │  Scheduler           │
│  server.ts)  │            │  (Background Worker) │
└──────┬───────┘            └──────────┬───────────┘
       │                               │
       │                               │
       └───────────┬───────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Notification    │
         │ API             │
         │ (High-level)    │
         └────────┬────────┘
                  │
                  ▼
       ┌──────────────────────┐
       │ Repository           │
       │ (Data Access Layer)  │
       └──────────┬───────────┘
                  │
                  ▼
          ┌──────────────┐
          │   Database   │
          │   (SQLite)   │
          └──────────────┘
```

---

## 🎉 Summary

The scheduled notification system is **production-ready** and meets all acceptance criteria:

1. ✅ **Precise Timing**: ±1 minute buffer
2. ✅ **Resilience**: Automatic recovery after downtime
3. ✅ **Idempotency**: Race condition prevention with distributed locks
4. ✅ **Graceful Failure**: Errors logged, retries handled, queue continues

The implementation includes:
- Complete database schema with migrations
- Background scheduler with distributed locking
- High-level API for scheduling
- REST endpoints for external access
- Comprehensive test suite
- Full documentation

Ready to install, configure, and deploy! 🚀
