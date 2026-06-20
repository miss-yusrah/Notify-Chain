# Quick Start - Scheduled Notifications

## Install & Setup (3 steps)

```bash
# 1. Install
npm install

# 2. Run migration
npm run migrate

# 3. Start service
npm run dev
```

## Basic Usage

### Schedule a notification (TypeScript)

```typescript
import { NotificationAPI } from './services/notification-api';

// Schedule for 1 hour from now
const id = await api.scheduleDiscordNotification(
  'https://discord.com/webhook/YOUR_WEBHOOK',
  { content: 'Scheduled message!' },
  new Date(Date.now() + 3600000)
);
```

### Schedule via REST API

```bash
curl -X POST http://localhost:8787/api/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {"message": "Hello"},
    "notificationType": "discord",
    "targetRecipient": "webhook-url",
    "executeAt": "2024-12-31T12:00:00Z"
  }'
```

### Check status

```bash
# Get specific notification
curl http://localhost:8787/api/schedule/1

# Get statistics
curl http://localhost:8787/api/schedule/stats
```

## Configuration

```bash
# .env file
SCHEDULER_ENABLED=true
DATABASE_PATH=./data/notifications.db
SCHEDULER_POLL_INTERVAL_MS=10000
SCHEDULER_BATCH_SIZE=10
```

## Common Tasks

### View all pending notifications
```sql
sqlite3 ./data/notifications.db \
  "SELECT id, execute_at, status FROM scheduled_notifications;"
```

### Cancel a notification
```typescript
await api.cancelNotification(123);
```

### Get statistics
```typescript
const stats = await api.getStatistics();
// { pending: 10, processing: 2, completed: 100, failed: 5 }
```

## Troubleshooting

### "Database not initialized"
```bash
npm run migrate
```

### Check logs
```bash
tail -f logs/app.log | grep scheduler
```

### Manually recover stale locks
```sql
sqlite3 ./data/notifications.db \
  "UPDATE scheduled_notifications 
   SET status='PENDING', processor_id=NULL 
   WHERE status='PROCESSING' AND lock_expires_at < datetime('now');"
```

## Need More Help?

- 📖 **Full Docs**: [README-SCHEDULER.md](./README-SCHEDULER.md)
- 🔧 **Installation**: [INSTALLATION.md](./INSTALLATION.md)
- 📝 **Examples**: [src/examples/schedule-notification-example.ts](./src/examples/schedule-notification-example.ts)
- 🧪 **Tests**: `npm test`
