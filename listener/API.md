# Listener Service API

Base URL: `http://localhost:8787` (configured via `EVENTS_API_PORT`)

---

## Events

### GET /api/events

Returns all stored contract events.

**Query Parameters**

| Name  | Type   | Required | Description                        |
|-------|--------|----------|------------------------------------|
| limit | number | No       | Maximum number of events to return |

**Response `200`**

```json
{
  "count": 42,
  "events": [
    {
      "eventId": "string",
      "contractAddress": "string",
      "eventName": "string | null",
      "ledger": 12345,
      "type": "contract",
      "topic": ["TaskCreated"],
      "value": "string",
      "txHash": "string",
      "receivedAt": 1718640000000
    }
  ]
}
```

---

## User Notification Preferences

Preferences control which notification categories are delivered per user. Categories default to **enabled** when not explicitly set.

### GET /api/preferences/:userId

Returns the notification preferences for a user.

**Path Parameters**

| Name   | Description        |
|--------|--------------------|
| userId | User identifier    |

**Response `200`**

```json
{
  "userId": "alice",
  "categories": {
    "discord": true
  },
  "updatedAt": 1718640000000
}
```

---

### PUT /api/preferences/:userId

Updates one or more notification category flags for a user. Unspecified categories are preserved.

**Path Parameters**

| Name   | Description        |
|--------|--------------------|
| userId | User identifier    |

**Request Body**

```json
{
  "categories": {
    "discord": false
  }
}
```

| Field      | Type                          | Required | Description                              |
|------------|-------------------------------|----------|------------------------------------------|
| categories | `Record<string, boolean>`     | Yes      | Map of category name to enabled flag     |

**Response `200`** — returns the full updated preferences object.

```json
{
  "userId": "alice",
  "categories": {
    "discord": false
  },
  "updatedAt": 1718640100000
}
```

**Response `400`** — returned when the request body is invalid JSON or the `categories` field is missing.

```json
{ "error": "Invalid body: expected { categories: { [key]: boolean } }" }
```

---

## Notification Categories

| Category  | Description                  |
|-----------|------------------------------|
| `discord` | Discord webhook notifications |

Additional categories can be added by extending the `categories` map.

---

## Per-Contract User Binding

To apply user preferences to a specific contract's events, set `userId` in the contract address config:

```json
{
  "CONTRACT_ADDRESSES": [
    {
      "address": "CCEMX6...",
      "events": ["*"],
      "userId": "alice"
    }
  ]
}
```

If `userId` is omitted, the `"global"` user's preferences are applied.
