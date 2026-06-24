# Notification Payload Schema

This document defines the structure, required fields, validation rules, and examples for notification payloads used by the NotifyChain listener service.

## Table of Contents

1. [Overview](#overview)
2. [Request Payload](#request-payload)
3. [Notification Types](#notification-types)
4. [Field Reference](#field-reference)
5. [JSON Examples](#json-examples)
6. [Validation Rules](#validation-rules)
7. [Versioning](#versioning)

---

## Overview

When scheduling a notification via the REST API, the caller provides a `CreateScheduledNotificationInput` object. The listener stores this, then delivers it at the specified time through the chosen channel (Discord, email, webhook, or SMS).

**Endpoint:** `POST /api/notifications/schedule`

---

## Request Payload

```typescript
interface CreateScheduledNotificationInput {
  payload:           Record<string, any>;   // required
  notificationType:  NotificationType;      // required
  targetRecipient:   string;                // required
  executeAt:         Date;                  // required (ISO 8601)
  maxRetries?:       number;                // optional, default 3
  eventId?:          string;                // optional
  contractAddress?:  string;                // optional
  priority?:         number;                // optional, default 0
  metadata?:         Record<string, any>;   // optional
}
```

---

## Notification Types

```typescript
enum NotificationType {
  DISCORD = 'discord',
  EMAIL   = 'email',
  WEBHOOK = 'webhook',
  SMS     = 'sms',
}
```

| Value     | Description                                      | `targetRecipient` format              |
|-----------|--------------------------------------------------|---------------------------------------|
| `discord` | Posts a message to a Discord channel via webhook | Discord webhook URL                   |
| `email`   | Sends an email to a recipient                    | Valid email address                   |
| `webhook` | HTTP POST to an arbitrary endpoint               | Full HTTPS URL                        |
| `sms`     | Sends an SMS to a phone number                   | E.164 format (e.g. `+15551234567`)    |

---

## Field Reference

### `payload` — required

A free-form JSON object containing the notification content. Its shape depends on `notificationType`:

| `notificationType` | Recommended fields in `payload`                                      |
|--------------------|----------------------------------------------------------------------|
| `discord`          | `content` (string), `embeds[]` (optional Discord embed objects)     |
| `email`            | `subject` (string), `body` (string), `html` (string, optional)      |
| `webhook`          | Any JSON your receiving endpoint expects                             |
| `sms`              | `message` (string, ≤ 160 chars for a single SMS segment)            |

### `notificationType` — required

One of the four values in the `NotificationType` enum. Determines both the delivery channel and how `payload` is interpreted.

### `targetRecipient` — required

The delivery destination. Format varies by `notificationType` (see table above).  
**Max length:** 512 characters.

### `executeAt` — required

ISO 8601 datetime string indicating when the notification should be delivered.  
Must be in the future at the time of scheduling.  
Example: `"2025-12-31T23:59:00.000Z"`

### `maxRetries` — optional

Number of delivery attempts before the notification is marked `FAILED`.  
**Default:** `3`  **Range:** `0–10`

### `eventId` — optional

The on-chain event ID that triggered this notification. Used for deduplication — the listener will not schedule two notifications with the same `eventId` and `notificationType`.  
**Max length:** 255 characters.

### `contractAddress` — optional

The Soroban contract address that emitted the triggering event. Used for audit and filtering.  
**Format:** Stellar strkey (56-character `C…` string).

### `priority` — optional

Integer controlling processing order when multiple notifications are due at the same time.  
**Higher value = processed first.**  **Default:** `0`  **Range:** `0–100`

### `metadata` — optional

Arbitrary key-value object stored alongside the notification. Not sent to the recipient; useful for internal tracking, tagging, or debugging.

---

## JSON Examples

### Discord notification

```json
{
  "payload": {
    "content": "🔔 New task created on NotifyChain!",
    "embeds": [
      {
        "title": "Task #42 — Write unit tests",
        "description": "Reward: 50 XLM",
        "color": 5814783,
        "timestamp": "2025-12-01T10:00:00.000Z"
      }
    ]
  },
  "notificationType": "discord",
  "targetRecipient": "https://discord.com/api/webhooks/123456789/abcdef",
  "executeAt": "2025-12-01T10:00:00.000Z",
  "maxRetries": 3,
  "eventId": "evt_abc123",
  "contractAddress": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "priority": 5
}
```

### Email notification

```json
{
  "payload": {
    "subject": "Your task submission was approved",
    "body": "Congratulations! Your submission for Task #42 has been approved. Your reward of 50 XLM has been released.",
    "html": "<p>Congratulations! Your submission for <strong>Task #42</strong> has been approved.</p>"
  },
  "notificationType": "email",
  "targetRecipient": "user@example.com",
  "executeAt": "2025-12-01T10:05:00.000Z",
  "priority": 10,
  "metadata": {
    "userId": "usr_789",
    "taskId": "42"
  }
}
```

### Webhook notification

```json
{
  "payload": {
    "event": "task.approved",
    "taskId": "42",
    "reward": "50",
    "currency": "XLM",
    "approvedAt": "2025-12-01T10:00:00.000Z"
  },
  "notificationType": "webhook",
  "targetRecipient": "https://api.yourapp.com/notifychain-events",
  "executeAt": "2025-12-01T10:00:00.000Z",
  "maxRetries": 5,
  "eventId": "evt_xyz456"
}
```

### SMS notification

```json
{
  "payload": {
    "message": "NotifyChain: Task #42 approved. Reward 50 XLM released to your wallet."
  },
  "notificationType": "sms",
  "targetRecipient": "+15551234567",
  "executeAt": "2025-12-01T10:00:00.000Z"
}
```

---

## Validation Rules

| Field             | Rule                                                                 |
|-------------------|----------------------------------------------------------------------|
| `payload`         | Must be a valid JSON object (not null, not an array)                |
| `notificationType`| Must be one of: `discord`, `email`, `webhook`, `sms`               |
| `targetRecipient` | Non-empty string, ≤ 512 chars. Format validated per channel.        |
| `executeAt`       | Must be a valid ISO 8601 datetime. Must be in the future.           |
| `maxRetries`      | Integer between 0 and 10 (inclusive). Defaults to 3.               |
| `eventId`         | Optional. If provided, used for deduplication. ≤ 255 chars.        |
| `contractAddress` | Optional. If provided, must be a valid Stellar strkey (56 chars).  |
| `priority`        | Integer between 0 and 100 (inclusive). Defaults to 0.              |
| `metadata`        | Optional. Must be a valid JSON object if provided.                  |

### Channel-specific validation

**Discord** — `targetRecipient` must start with `https://discord.com/api/webhooks/`.  
**Email** — `targetRecipient` must match standard email format (`user@domain.tld`).  
**Webhook** — `targetRecipient` must be a valid HTTPS URL.  
**SMS** — `targetRecipient` must match E.164 format (`+` followed by 7–15 digits).

### Deduplication

If `eventId` is provided, the system checks for an existing `PENDING` or `COMPLETED` notification with the same `eventId` and `notificationType`. If found, the new request is rejected with HTTP `409 Conflict` to prevent duplicate deliveries.

---

## Versioning

| Version | Date       | Changes                                                   |
|---------|------------|-----------------------------------------------------------|
| v1.0    | 2025-12-01 | Initial schema — four channel types, priority, metadata   |

Breaking changes to this schema (removing or renaming required fields) will be communicated with a major version bump and a minimum 30-day deprecation notice in the changelog.
