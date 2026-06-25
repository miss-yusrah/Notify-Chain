# Notification Archiving Service

## Overview

The archiving service automatically moves old, terminal-state notifications out of the active `scheduled_notifications` table into a read-only `notification_archive` table.  Archived records remain fully queryable for audit purposes and are permanently deleted only after a configurable grace period.

---

## How the Archiving Loop Works

A background worker (`ArchiveService`) runs on a configurable interval.  Each cycle has two phases:

```
Every ARCHIVE_INTERVAL_MS (default 6 h)
│
├─ Phase 1 — Archive
│    SELECT up to ARCHIVE_BATCH_SIZE rows FROM scheduled_notifications
│      WHERE status IN ('COMPLETED','FAILED','CANCELLED')
│        AND processing_completed_at < NOW() - ARCHIVE_AFTER_MS
│    ↓ TRANSACTION
│    INSERT those rows INTO notification_archive
│    DELETE those rows FROM scheduled_notifications
│
└─ Phase 2 — Purge  (skipped when ARCHIVE_DELETE_AFTER_MS = 0)
     DELETE FROM notification_archive
       WHERE archived_at < NOW() - ARCHIVE_DELETE_AFTER_MS
```

Both phases run inside a single `setInterval` tick.  The batch size cap keeps individual transactions short and prevents long table locks.

---

## Data Schema

### `notification_archive` table (new)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Archive-table primary key |
| `original_id` | INTEGER | PK from `scheduled_notifications` at archival time |
| `payload` | TEXT | JSON notification payload |
| `notification_type` | VARCHAR(50) | discord / email / webhook / sms |
| `target_recipient` | TEXT | User ID, webhook URL, etc. |
| `execute_at` | DATETIME | Original scheduled time |
| `created_at` | DATETIME | When the notification was originally created |
| `processing_completed_at` | DATETIME | When the notification finished processing (nullable) |
| `status` | VARCHAR(20) | Terminal status at archival: COMPLETED / FAILED / CANCELLED |
| `retry_count` | INTEGER | Final retry count |
| `last_error` | TEXT | Last error message (nullable) |
| `event_id` | TEXT | Source blockchain event ID (nullable) |
| `contract_address` | TEXT | Source contract address (nullable) |
| `metadata` | TEXT | JSON metadata blob (nullable) |
| `archived_at` | DATETIME | When this row was inserted into the archive |

The archive table is append-only; no UPDATE triggers are applied.

---

## Retention Policy

| Variable | Default | Description |
|---|---|---|
| `ARCHIVE_ENABLED` | `true` | Set to `false` to disable the worker entirely |
| `ARCHIVE_INTERVAL_MS` | `21600000` (6 h) | How often the cycle runs |
| `ARCHIVE_AFTER_MS` | `604800000` (7 d) | Move notifications completed > X ms ago |
| `ARCHIVE_DELETE_AFTER_MS` | `7776000000` (90 d) | Permanently delete archive rows > X ms old; `0` = never delete |
| `ARCHIVE_BATCH_SIZE` | `500` | Max rows archived per cycle |

Set these in your `.env` file or as environment variables before starting the service.

Example — archive after 3 days, purge after 30 days, run every hour:

```env
ARCHIVE_AFTER_MS=259200000
ARCHIVE_DELETE_AFTER_MS=2592000000
ARCHIVE_INTERVAL_MS=3600000
```

---

## API Endpoints

All endpoints return `application/json`.

### `GET /api/archive`

Paginated list of archived notifications for audit queries.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `limit` | number | Max records to return (default: service default) |
| `offset` | number | Pagination offset |
| `status` | string | Filter by terminal status: `COMPLETED`, `FAILED`, `CANCELLED` |
| `contractAddress` | string | Filter by source contract address |
| `startDate` | ISO 8601 | Filter `archived_at >= startDate` |
| `endDate` | ISO 8601 | Filter `archived_at <= endDate` |

**Response**
```json
{
  "records": [ /* ArchivedNotification[] */ ],
  "total": 1024,
  "limit": 20,
  "offset": 0,
  "itemCount": 20,
  "totalPages": 52
}
```

### `GET /api/archive/:id`

Fetch a single archived record by its archive-table PK.

- **200** — record found
- **404** — no record with that `id`

### `POST /api/archive/run`  *(admin)*

Trigger an on-demand archive + purge cycle immediately.  Requires `ArchiveService` to be enabled.

**Response**
```json
{
  "archived": 12,
  "purged": 3,
  "durationMs": 45
}
```

---

## Operational Notes

- **No data loss on crash** — because archival is transactional (copy + delete in one SQLite transaction), a crash mid-cycle leaves the original rows intact and the partial archive rows are cleaned up on the next cycle (duplicate `original_id` rows are harmless for read queries).
- **Active notifications are never touched** — only rows with a terminal status (`COMPLETED`, `FAILED`, `CANCELLED`) *and* a non-null `processing_completed_at` older than `ARCHIVE_AFTER_MS` are eligible.
- **Disabling** — set `ARCHIVE_ENABLED=false` to keep all notifications in the active table indefinitely.  The `notification_archive` table is still created; it will simply remain empty.
