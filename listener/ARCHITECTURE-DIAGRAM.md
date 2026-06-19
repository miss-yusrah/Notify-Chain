# Scheduled Notification System - Architecture Diagrams

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Notify-Chain Listener                       │
│                                                                  │
│  ┌────────────────┐              ┌─────────────────────┐       │
│  │  Event         │              │  Scheduled          │       │
│  │  Subscriber    │              │  Notification       │       │
│  │  (Existing)    │              │  System (NEW)       │       │
│  │                │              │                     │       │
│  │  - Poll Stellar│              │  - Poll Database    │       │
│  │  - Discord     │              │  - Process Due      │       │
│  │  - In-memory   │              │  - Persistent       │       │
│  └────────────────┘              └─────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              REST API (events-server.ts)                  │  │
│  │  /api/events    /api/schedule    /api/schedule/stats    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Scheduling Flow

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│  User /  │ Schedule│ Notification │  Store  │   Database   │
│  System  ├────────>│     API      ├────────>│   (SQLite)   │
└──────────┘         └──────────────┘         └──────────────┘
                                                      │
                                                      │ Status: PENDING
                                                      │ execute_at: 2024-12-31 12:00
                                                      ▼
```

## Processing Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     Background Scheduler                          │
│                    (Runs every 10 seconds)                        │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │  1. Recover Stale Locks               │
        │     - Find expired locks              │
        │     - Reset to PENDING                │
        └───────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │  2. Fetch Pending Notifications       │
        │     WHERE status = 'PENDING'          │
        │     AND execute_at <= NOW()           │
        │     LIMIT 10                          │
        └───────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │  3. Atomic Lock Acquisition           │
        │     UPDATE SET status = 'PROCESSING'  │
        │              processor_id = 'uuid'    │
        │              lock_expires_at = NOW+60s│
        └───────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │  4. Process Each Notification         │
        │     - Execute delivery                │
        │     - Log attempt                     │
        └───────────────────────────────────────┘
                                │
                    ┌───────────┴──────────┐
                    │                      │
                    ▼                      ▼
        ┌──────────────────┐   ┌──────────────────┐
        │  SUCCESS         │   │  FAILURE         │
        │  Mark COMPLETED  │   │  Retry or FAILED │
        └──────────────────┘   └──────────────────┘
```

## Multi-Instance Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                     Shared SQLite Database                   │
│                   scheduled_notifications                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ id │ status    │ processor_id │ lock_expires_at      │  │
│  ├────┼───────────┼──────────────┼──────────────────────┤  │
│  │ 1  │PROCESSING │ worker-abc   │ 2024-12-31 12:01:00 │  │
│  │ 2  │PROCESSING │ worker-abc   │ 2024-12-31 12:01:00 │  │
│  │ 3  │PROCESSING │ worker-xyz   │ 2024-12-31 12:01:00 │  │
│  │ 4  │PROCESSING │ worker-xyz   │ 2024-12-31 12:01:00 │  │
│  │ 5  │PENDING    │ NULL         │ NULL                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                    ▲                        ▲
                    │                        │
        ┌───────────┴─────────┐  ┌───────────┴─────────┐
        │   Worker Instance 1 │  │   Worker Instance 2 │
        │   processor_id:     │  │   processor_id:     │
        │   worker-abc        │  │   worker-xyz        │
        │                     │  │                     │
        │   Locked: 1, 2      │  │   Locked: 3, 4      │
        └─────────────────────┘  └─────────────────────┘
```

## Catch-Up Logic After Downtime

```
Timeline:

10:00 AM │ Schedule notification for 10:30 AM
         │ ┌────────────────────────────────────────┐
         │ │ INSERT scheduled_notifications         │
         │ │ execute_at = '2024-12-31 10:30:00'    │
         │ │ status = 'PENDING'                     │
         │ └────────────────────────────────────────┘
         │
10:15 AM │ ❌ SERVER CRASHES
         │
         │ (Server is down)
         │
10:30 AM │ ⏰ Scheduled time passes (notification missed)
         │
         │ (Server still down)
         │
11:00 AM │ ✅ SERVER RESTARTS
         │ ┌────────────────────────────────────────┐
         │ │ Scheduler starts                       │
         │ │ recoverStaleLocks()                   │
         │ └────────────────────────────────────────┘
         │
11:00:10 │ 📨 NOTIFICATION PROCESSED (Next poll cycle)
         │ ┌────────────────────────────────────────┐
         │ │ SELECT * WHERE execute_at <= NOW()     │
         │ │ (includes 10:30 AM notification)      │
         │ │                                        │
         │ │ Process immediately                    │
         │ │ Mark as COMPLETED                      │
         │ └────────────────────────────────────────┘
         │
         ▼
    Result: No notifications lost! ✅
```

## Race Condition Prevention

```
Scenario: Two workers try to process the same notification

┌──────────────────┐              ┌──────────────────┐
│   Worker A       │              │   Worker B       │
│  (worker-abc)    │              │  (worker-xyz)    │
└────────┬─────────┘              └────────┬─────────┘
         │                                 │
         │  Atomic UPDATE                  │  Atomic UPDATE
         │  SET processor_id='worker-abc'  │  SET processor_id='worker-xyz'
         │  WHERE id IN (                  │  WHERE id IN (
         │    SELECT id FROM ... LIMIT 10) │    SELECT id FROM ... LIMIT 10)
         │                                 │
         ▼                                 ▼
         │                                 │
    ┌────▼──────────────────────────────────▼─────┐
    │         Database (Atomic Execution)         │
    │                                              │
    │  ✅ Worker A locks: [1, 2, 3, 4, 5]         │
    │  ❌ Worker B locks: [] (already locked)     │
    │                                              │
    │  Rows 1-5 now have processor_id='worker-abc'│
    └──────────────────────────────────────────────┘
                    │                   │
                    ▼                   ▼
         ┌──────────────────┐  ┌──────────────────┐
         │  Worker A        │  │  Worker B        │
         │  Processes 1-5   │  │  Fetches next    │
         │  ✅ Success      │  │  batch (6-15)    │
         └──────────────────┘  └──────────────────┘

Result: No duplicate processing! ✅
```

## Database Schema Relationships

```
┌─────────────────────────────────────────────────────────────┐
│               scheduled_notifications (Primary)              │
├─────────────────────────────────────────────────────────────┤
│ PK: id (INTEGER)                                            │
│                                                              │
│ Notification Data:                                          │
│   - payload (TEXT/JSON)                                     │
│   - notification_type (VARCHAR)                             │
│   - target_recipient (TEXT)                                 │
│                                                              │
│ Scheduling:                                                 │
│   - execute_at (DATETIME) ◄── Used for polling            │
│   - created_at (DATETIME)                                   │
│   - updated_at (DATETIME)                                   │
│                                                              │
│ Status Tracking:                                            │
│   - status (VARCHAR) ◄── PENDING → PROCESSING → COMPLETED  │
│   - retry_count (INTEGER)                                   │
│   - max_retries (INTEGER)                                   │
│                                                              │
│ Distributed Locking:                                        │
│   - processor_id (VARCHAR) ◄── Unique worker ID            │
│   - lock_expires_at (DATETIME) ◄── Lock timeout            │
│                                                              │
│ Error Tracking:                                             │
│   - last_error (TEXT)                                       │
│   - error_details (TEXT/JSON)                               │
│                                                              │
│ Metadata:                                                   │
│   - priority (INTEGER)                                      │
│   - event_id (TEXT)                                         │
│   - contract_address (TEXT)                                 │
│   - metadata (TEXT/JSON)                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ FK: scheduled_notification_id
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│          notification_execution_log (Audit Trail)            │
├─────────────────────────────────────────────────────────────┤
│ PK: id (INTEGER)                                            │
│ FK: scheduled_notification_id (INTEGER)                     │
│                                                              │
│   - execution_attempt (INTEGER)                             │
│   - execution_time (DATETIME)                               │
│   - status (VARCHAR) ◄── SUCCESS, FAILED, RETRY            │
│   - error_message (TEXT)                                    │
│   - response_data (TEXT/JSON)                               │
│   - duration_ms (INTEGER)                                   │
└─────────────────────────────────────────────────────────────┘
```

## Status State Machine

```
                    ┌─────────────┐
                    │   PENDING   │ ◄── Initial state
                    └──────┬──────┘
                           │
                           │ Scheduler picks up
                           │ (execute_at <= NOW)
                           ▼
                    ┌─────────────┐
                    │ PROCESSING  │ ◄── Worker locked
                    └──────┬──────┘
                           │
                ┌──────────┴──────────┐
                │                     │
         Success│                     │Failure
                ▼                     ▼
         ┌─────────────┐      ┌─────────────────┐
         │  COMPLETED  │      │ retry_count++   │
         └─────────────┘      └────────┬────────┘
                                       │
                             ┌─────────┴─────────┐
                             │                   │
                   retry_count < max_retries     │
                             │                   │
                             ▼                   ▼
                      ┌─────────────┐     ┌──────────┐
                      │   PENDING   │     │  FAILED  │
                      │  (retry)    │     └──────────┘
                      └─────────────┘

Special case:
         ┌─────────────┐
         │   PENDING   │
         └──────┬──────┘
                │
                │ User cancels
                ▼
         ┌─────────────┐
         │  CANCELLED  │
         └─────────────┘
```

## API Request Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ POST /api/schedule
       │ {
       │   "payload": {...},
       │   "executeAt": "2024-12-31T12:00:00Z",
       │   "targetRecipient": "webhook-url"
       │ }
       ▼
┌─────────────────────┐
│  Events Server      │
│  (events-server.ts) │
└──────┬──────────────┘
       │
       │ Validate request
       │ Parse JSON body
       ▼
┌─────────────────────┐
│  Notification API   │
│  (notification-     │
│   api.ts)           │
└──────┬──────────────┘
       │
       │ Validate inputs
       │ - executeAt is future
       │ - payload is valid
       ▼
┌─────────────────────┐
│  Repository         │
│  (scheduled-        │
│   notification-     │
│   repository.ts)    │
└──────┬──────────────┘
       │
       │ INSERT INTO scheduled_notifications
       │ VALUES (...)
       ▼
┌─────────────────────┐
│  Database           │
│  (SQLite)           │
└──────┬──────────────┘
       │
       │ Return ID: 123
       ▼
┌─────────────┐
│   Client    │
│  {"id": 123}│
└─────────────┘
```

## Monitoring Dashboard (Conceptual)

```
┌────────────────────────────────────────────────────────┐
│         Scheduled Notification Dashboard               │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Statistics:                                           │
│  ┌─────────┬──────────┬───────────┬─────────┐        │
│  │ Pending │Processing│ Completed │ Failed  │        │
│  │   45    │    3     │   1,234   │   12    │        │
│  └─────────┴──────────┴───────────┴─────────┘        │
│                                                         │
│  Recent Notifications:                                 │
│  ┌──┬─────────┬───────────────┬───────────┬────────┐ │
│  │ID│  Type   │  Execute At   │  Status   │ Retry │ │
│  ├──┼─────────┼───────────────┼───────────┼────────┤ │
│  │45│ Discord │ 12:30:00      │ PENDING   │  0/3  │ │
│  │44│ Discord │ 12:25:00      │ PROCESSING│  0/3  │ │
│  │43│ Discord │ 12:20:00      │ COMPLETED │  1/3  │ │
│  │42│ Discord │ 12:15:00      │ FAILED    │  3/3  │ │
│  └──┴─────────┴───────────────┴───────────┴────────┘ │
│                                                         │
│  Overdue: 2 notifications                              │
│  Next execution: 12:30:00 (in 5 minutes)              │
│                                                         │
└────────────────────────────────────────────────────────┘

Available via: GET /api/schedule/stats
```

## System Components Summary

```
┌────────────────────────────────────────────────────────────┐
│                     Component Stack                         │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Application Layer:                                        │
│  └── index.ts (Service initialization & orchestration)    │
│                                                             │
│  API Layer:                                                │
│  ├── events-server.ts (REST endpoints)                    │
│  └── notification-api.ts (High-level interface)           │
│                                                             │
│  Service Layer:                                            │
│  ├── notification-scheduler.ts (Background worker)        │
│  └── scheduled-notification-repository.ts (Data access)   │
│                                                             │
│  Database Layer:                                           │
│  ├── database.ts (SQLite connection)                      │
│  └── schema.sql (Database schema)                         │
│                                                             │
│  Configuration:                                            │
│  └── config.ts (Environment-based config)                 │
│                                                             │
│  Types:                                                    │
│  └── scheduled-notification.ts (TypeScript types)         │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **Poll Interval** | 10 seconds | Configurable |
| **Batch Size** | 10 notifications | Configurable |
| **Lock Timeout** | 60 seconds | Prevents deadlocks |
| **Timing Precision** | ±1 minute | Within buffer |
| **Max Retries** | 3 (default) | Per notification |
| **Database** | SQLite | Single file, ACID |
| **Concurrency** | Multi-instance safe | Distributed locks |

---

These diagrams illustrate the complete architecture and workflow of the scheduled notification system.
