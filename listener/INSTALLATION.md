# Installation Guide - Scheduled Notification System

## Quick Start

### 1. Install Dependencies

```bash
cd listener
npm install
```

This will install the required dependencies:
- `sqlite3`: SQLite database driver for persistent storage
- `uuid`: For generating unique processor IDs
- `@types/uuid`: TypeScript types for UUID

### 2. Run Database Migration

Before starting the service, you need to initialize the database:

```bash
npm run migrate
```

This creates:
- Database file at `./data/notifications.db` (or path specified in `DATABASE_PATH`)
- `scheduled_notifications` table with indexes
- `notification_execution_log` table
- Triggers for automatic timestamp updates

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure the scheduler settings:

```bash
# Enable the scheduler
SCHEDULER_ENABLED=true

# Database location
DATABASE_PATH=./data/notifications.db

# How often to check for due notifications (milliseconds)
SCHEDULER_POLL_INTERVAL_MS=10000

# How long a processor can hold a lock (milliseconds)
SCHEDULER_LOCK_TIMEOUT_MS=60000

# How many notifications to process per cycle
SCHEDULER_BATCH_SIZE=10

# Allow notifications within this buffer time (milliseconds)
SCHEDULER_TIMING_BUFFER_MS=60000

# Optional: Set a specific processor ID (auto-generated if not set)
SCHEDULER_PROCESSOR_ID=
```

### 4. Start the Service

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

You should see:
```
info: Initializing database for scheduled notifications
info: Connected to SQLite database
info: Database migration completed successfully
info: Notification scheduler started successfully
info: Events API server listening {"port":8787}
```

## Verification

### Check if the scheduler is running

```bash
curl http://localhost:8787/api/schedule/stats
```

Expected response:
```json
{
  "pending": 0,
  "processing": 0,
  "completed": 0,
  "failed": 0,
  "overdue": 0
}
```

### Schedule a test notification

```bash
curl -X POST http://localhost:8787/api/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {"message": "Test notification"},
    "notificationType": "discord",
    "targetRecipient": "YOUR_DISCORD_WEBHOOK_URL",
    "executeAt": "'$(date -u -d "+5 minutes" +%Y-%m-%dT%H:%M:%SZ)'",
    "priority": 5
  }'
```

Expected response:
```json
{
  "id": 1
}
```

### Check notification status

```bash
curl http://localhost:8787/api/schedule/1
```

## Database Verification

You can directly inspect the database:

```bash
sqlite3 ./data/notifications.db
```

SQL commands:
```sql
-- View all scheduled notifications
SELECT id, notification_type, status, execute_at, retry_count 
FROM scheduled_notifications 
ORDER BY created_at DESC;

-- View execution logs
SELECT * FROM notification_execution_log 
ORDER BY execution_time DESC 
LIMIT 10;

-- Check statistics
SELECT status, COUNT(*) as count 
FROM scheduled_notifications 
GROUP BY status;
```

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- Repository CRUD operations
- Distributed locking
- Race condition prevention
- Stale lock recovery
- Retry logic
- API validation

## Troubleshooting

### Issue: "Database not initialized"

**Solution**: Run the migration script:
```bash
npm run migrate
```

### Issue: "SQLITE_ERROR: no such table: scheduled_notifications"

**Solution**: The migration didn't run successfully. Check:
1. Database file permissions
2. `./data/` directory exists
3. Run migration again with verbose logging:
   ```bash
   NODE_ENV=development npm run migrate
   ```

### Issue: Notifications not being processed

**Solution**: Check the following:

1. Is the scheduler enabled?
   ```bash
   grep SCHEDULER_ENABLED .env
   ```

2. Check application logs:
   ```bash
   tail -f logs/app.log | grep scheduler
   ```

3. Check for stale locks:
   ```sql
   SELECT * FROM scheduled_notifications 
   WHERE status = 'PROCESSING' 
   AND lock_expires_at < datetime('now');
   ```

4. Manually recover stale locks:
   ```sql
   UPDATE scheduled_notifications 
   SET status = 'PENDING', processor_id = NULL, lock_expires_at = NULL
   WHERE status = 'PROCESSING' 
   AND lock_expires_at < datetime('now');
   ```

### Issue: "Module not found: 'sqlite3'"

**Solution**: Rebuild native modules:
```bash
npm rebuild sqlite3
```

Or reinstall:
```bash
npm uninstall sqlite3
npm install sqlite3
```

### Issue: Multiple instances picking up the same notification

**Solution**: This shouldn't happen due to distributed locking, but if it does:

1. Check that each instance has a unique `SCHEDULER_PROCESSOR_ID`:
   ```bash
   # Instance 1
   SCHEDULER_PROCESSOR_ID=worker-1
   
   # Instance 2
   SCHEDULER_PROCESSOR_ID=worker-2
   ```

2. Verify the lock timeout is appropriate:
   ```bash
   SCHEDULER_LOCK_TIMEOUT_MS=60000
   ```

3. Check database for lock conflicts:
   ```sql
   SELECT processor_id, COUNT(*) 
   FROM scheduled_notifications 
   WHERE status = 'PROCESSING' 
   GROUP BY processor_id;
   ```

## Multi-Instance Deployment

To run multiple instances (for high availability):

### Using Docker Compose

```yaml
version: '3.8'
services:
  listener-1:
    build: .
    environment:
      - SCHEDULER_PROCESSOR_ID=worker-1
      - DATABASE_PATH=/data/notifications.db
    volumes:
      - notification-data:/data

  listener-2:
    build: .
    environment:
      - SCHEDULER_PROCESSOR_ID=worker-2
      - DATABASE_PATH=/data/notifications.db
    volumes:
      - notification-data:/data

volumes:
  notification-data:
```

### Using PM2

```bash
# Start 3 instances with different processor IDs
pm2 start npm --name "listener-1" -- start -- SCHEDULER_PROCESSOR_ID=worker-1
pm2 start npm --name "listener-2" -- start -- SCHEDULER_PROCESSOR_ID=worker-2
pm2 start npm --name "listener-3" -- start -- SCHEDULER_PROCESSOR_ID=worker-3
```

## Next Steps

- Read [README-SCHEDULER.md](./README-SCHEDULER.md) for detailed documentation
- Check [schedule-notification-example.ts](./src/examples/schedule-notification-example.ts) for usage examples
- Review [notification-scheduler.test.ts](./src/tests/notification-scheduler.test.ts) for test examples

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review application logs
3. Inspect the database directly
4. Open an issue on the project repository

## See also

- [API Usage Cookbook](API_USAGE_COOKBOOK.md) — practical end-to-end examples for every endpoint, including curl/Node.js signing and recovery workflows
- [API Reference](API.md) — full request/response schema for every endpoint
