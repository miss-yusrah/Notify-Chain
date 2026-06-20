# Notification Failure Recovery

A complete guide to how NotifyChain detects, retries, and monitors failed notifications in the off-chain listener service.

## Table of Contents

1. [Overview](#overview)
2. [Failure Types](#failure-types)
3. [Retry Lifecycle](#retry-lifecycle)
4. [Architecture Diagram](#architecture-diagram)
5. [Configuration Options](#configuration-options)
6. [Monitoring and Logs](#monitoring-and-logs)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The NotifyChain listener service continuously polls the Stellar/Soroban RPC for contract events. Two distinct failure scenarios each have their own recovery behaviour:

| Failure Type | Effect on Event Processing | Recovery Strategy |
|---|---|---|
| RPC polling error (all contracts fail) | Events cannot be fetched | Exponential-backoff reconnection up to `MAX_RECONNECT_ATTEMPTS` |
| Discord webhook error | Notification not sent | Event is still stored; failure is logged |

The two paths are intentionally independent: a broken Discord webhook never prevents events from being indexed, and an RPC failure triggers a full reconnection cycle before any notification is attempted.

---

## Failure Types

### 1. RPC / Polling Failure

Occurs when `EventSubscriber` cannot reach the Stellar RPC endpoint or when every configured contract address fails to return events in a single poll cycle.

**Detection** — `checkForEvents()` tracks a `failureCount` per poll. If every contract request fails, the method throws:

```
Failed to fetch events for all N configured contract(s)
```

This exception propagates to `poll()`, which then invokes `handleReconnection()`.

**Partial failures** (some contracts succeed, some fail) are logged as warnings but do **not** trigger reconnection — polling continues normally on the next tick.

### 2. Discord Notification Failure

Occurs when `DiscordNotificationService.sendEventNotification()` receives a non-`2xx` HTTP response or throws a network error.

**Detection** — `sendWebhook()` inspects `response.ok`. On failure it logs the HTTP status and response body, then returns `false`.

`processEvent()` in the subscriber checks this return value:

```typescript
if (!success) {
  logger.warn('Failed to send Discord notification, event will still be processed', {
    eventId: event.id,
  });
}
```

The event is already stored in `eventRegistry` before the notification is attempted, so **no event data is lost** when a webhook fails.

---

## Retry Lifecycle

### RPC Reconnection

```
poll() catches error
       │
       ▼
handleReconnection()
       │
       ├─ reconnectAttempts >= MAX_RECONNECT_ATTEMPTS?
       │       │
       │       YES → log error, call stop(), exit loop
       │       │
       │      NO
       │       │
       ▼       ▼
  increment reconnectAttempts
       │
       ▼
delay = RECONNECT_DELAY_MS × reconnectAttempts   (linear backoff)
       │
       ▼
  await delay
       │
       ▼
  loop resumes → attempt checkForEvents() again
```

**Backoff schedule** with default settings (`RECONNECT_DELAY_MS=5000`, `MAX_RECONNECT_ATTEMPTS=5`):

| Attempt | Wait Before Retry |
|---------|-------------------|
| 1 | 5 s |
| 2 | 10 s |
| 3 | 15 s |
| 4 | 20 s |
| 5 | 25 s |
| — | Service stops |

After a **successful** poll, `reconnectAttempts` resets to `0` so the backoff counter is fresh for the next outage.

### Discord Retry

There is currently no automatic Discord retry. Each notification attempt is fire-and-forget within a single poll cycle. The failure is logged and the listener moves on to the next event. Restarting the listener service is the recovery path if persistent webhook failures need to be re-sent (see [Troubleshooting](#troubleshooting)).

---

## Architecture Diagram

The diagram below shows where failures can occur and how they propagate.

```
                        ┌─────────────────────┐
                        │   Stellar RPC Node  │
                        └──────────┬──────────┘
                                   │
                          getEvents() request
                                   │
                        ┌──────────▼──────────┐
                        │  EventSubscriber    │
                        │  ─────────────────  │
                        │  poll()             │◄── POLL_INTERVAL_MS
                        │    checkForEvents() │
                        │    ├ [RPC error] ──►│── handleReconnection()
                        │    │                │      │
                        │    │                │      ├─ within MAX_RECONNECT_ATTEMPTS → retry
                        │    │                │      └─ exceeded → stop()
                        │    └ [success]      │
                        │        processEvent()
                        └──────────┬──────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │                             │
                    ▼                             ▼
          ┌─────────────────┐          ┌─────────────────────┐
          │  eventRegistry  │          │DiscordNotification  │
          │  (in-memory)    │          │Service              │
          │                 │          │  sendWebhook()      │
          │  Always updated │          │  ├ [HTTP !ok] ──► log warning
          │  before Discord │          │  └ [ok] ──► success │
          │  is called      │          └─────────────────────┘
          └─────────────────┘                    │
                    │                            │
                    ▼                            ▼
          ┌─────────────────┐          ┌─────────────────────┐
          │  Events API     │          │   Discord Channel   │
          │  (port 8787)    │          └─────────────────────┘
          └─────────────────┘
```

**Key invariant**: `eventRegistry` is updated *before* any Discord call. A webhook failure never causes an event to be dropped from the API.

---

## Configuration Options

All values are set via environment variables (see `listener/.env.example`).

| Variable | Default | Description |
|---|---|---|
| `POLL_INTERVAL_MS` | `30000` | Milliseconds between poll cycles when healthy |
| `MAX_RECONNECT_ATTEMPTS` | `5` | Maximum consecutive RPC failures before the service stops |
| `RECONNECT_DELAY_MS` | `5000` | Base delay for the backoff calculation (`delay = RECONNECT_DELAY_MS × attempt`) |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org:443` | Stellar RPC endpoint |
| `DISCORD_WEBHOOK_URL` | *(unset)* | Full Discord webhook URL; Discord integration is disabled if omitted |
| `DISCORD_WEBHOOK_ID` | *(unset)* | Webhook ID used for log correlation; required alongside `DISCORD_WEBHOOK_URL` |

### Example `.env` for high-availability

```env
POLL_INTERVAL_MS=10000
MAX_RECONNECT_ATTEMPTS=10
RECONNECT_DELAY_MS=3000
STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
DISCORD_WEBHOOK_ID=<id>
```

This retries up to 10 times with a shorter base delay (3 s, 6 s, … 30 s) and polls every 10 s when healthy.

### Disabling Discord

If both `DISCORD_WEBHOOK_URL` and `DISCORD_WEBHOOK_ID` are absent, the Discord service is not instantiated and no webhook calls are made. Events are still indexed and served from the Events API.

---

## Monitoring and Logs

The listener uses structured JSON logging (`logger` from `utils/logger.ts`). All log entries include relevant context fields for filtering.

### Key log messages

| Situation | Level | Message |
|---|---|---|
| Successful poll | `info` | `Received events` |
| Discord notification sent | `info` | `Discord notification sent successfully` |
| Partial contract failure | `error` | `Error fetching events for contract` |
| All contracts failed | `error` | `Error polling for events` |
| Reconnection scheduled | `warn` | `Attempting to reconnect` |
| Max retries exceeded | `error` | `Max reconnection attempts exceeded, stopping service` |
| Discord webhook failed | `error` | `Discord webhook failed` |
| Discord failure (non-fatal) | `warn` | `Failed to send Discord notification, event will still be processed` |
| Invalid event payload skipped | `warn` | `Skipping invalid event payload` |

### Watching reconnection attempts

```bash
# Stream reconnect warnings live
node dist/index.js 2>&1 | grep -i reconnect

# Count failed attempts in a log file
grep "Attempting to reconnect" listener.log | wc -l
```

### Verifying Discord delivery

```bash
# Check for any webhook errors in the last hour
grep "Discord webhook failed" listener.log | tail -20
```

---

## Troubleshooting

### Service stopped after max reconnection attempts

**Symptom**: Log shows `Max reconnection attempts exceeded, stopping service`. The process exits.

**Causes**:
- Stellar RPC node is unreachable or rate-limiting requests
- `STELLAR_RPC_URL` is wrong or the endpoint changed
- Network issue between the listener host and the RPC node

**Steps**:
1. Verify the RPC endpoint is reachable:
   ```bash
   curl -s https://soroban-testnet.stellar.org:443 | head -c 200
   ```
2. Check `STELLAR_RPC_URL` in your `.env` matches the correct network.
3. Consider increasing `MAX_RECONNECT_ATTEMPTS` or using a fallback RPC URL.
4. Restart the service once the network issue is resolved:
   ```bash
   npm run start
   ```

---

### Discord notifications not arriving

**Symptom**: Events appear in the Events API but no messages appear in Discord.

**Causes**:
- Webhook URL or ID is incorrect
- Webhook was deleted in Discord
- Discord API is rate-limiting or returning non-`2xx` responses

**Steps**:
1. Confirm the environment variables are set:
   ```bash
   echo $DISCORD_WEBHOOK_URL
   echo $DISCORD_WEBHOOK_ID
   ```
2. Send a test message manually:
   ```bash
   curl -H "Content-Type: application/json" \
     -d '{"content": "Test from NotifyChain"}' \
     $DISCORD_WEBHOOK_URL
   ```
3. Search logs for the error details:
   ```bash
   grep "Discord webhook failed" listener.log
   # Output includes: status, statusText, error body, webhookId
   ```
4. If the webhook was deleted, create a new one in Discord, update `.env`, and restart.

---

### Events are not being detected

**Symptom**: No `Received events` log lines appear even though contracts are active.

**Causes**:
- `CONTRACT_ADDRESSES` is empty or contains wrong addresses
- `POLL_INTERVAL_MS` is very large
- The cursor has advanced past available ledger history on the RPC node

**Steps**:
1. Confirm contract addresses in `.env`:
   ```bash
   echo $CONTRACT_ADDRESSES
   # Should be valid JSON: [{"address":"C...","events":["*"]}]
   ```
2. Verify the event filter. `"*"` matches all events; named filters (e.g. `["TaskCreated"]`) must match the exact event name from the contract.
3. Check that `POLL_INTERVAL_MS` is not accidentally set to a very high value.
4. If cursor drift is suspected, stop the service, delete any persisted cursor state, and restart so polling begins from `startLedger: 1`.

---

### Partial contract failures on every poll

**Symptom**: Logs show repeated `Error fetching events for contract` for one address but others succeed.

**Cause**: That specific contract address may be invalid, may not exist on the configured network, or may have been removed.

**Steps**:
1. Validate the address against the network using the Stellar CLI:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ADDRESS> \
     --network testnet \
     -- \
     --help
   ```
2. Remove or correct the address in `CONTRACT_ADDRESSES`.

---

## Related Documentation

- [README.md](README.md) — Project overview and architecture
- [listener/.env.example](listener/.env.example) — Full list of environment variables
- `listener/src/services/event-subscriber.ts` — Polling and reconnection logic
- `listener/src/services/discord-notification.ts` — Discord webhook implementation
- [Documents/Task Bounty/ARCHITECTURE.md](Documents/Task%20Bounty/ARCHITECTURE.md) — Contract architecture
- [Documents/Task Bounty/WORKFLOWS.md](Documents/Task%20Bounty/WORKFLOWS.md) — On-chain event workflows
