# Soroban Project

## Project Structure

This repository uses the recommended structure for a Soroban project:
```text
.
├── contracts
│   └── hello-world
│       ├── src
│       │   ├── lib.rs
│       │   └── test.rs
│       └── Cargo.toml
├── Cargo.toml
└── README.md
```

- New Soroban contracts can be put in `contracts`, each in their own directory. There is already a `hello-world` contract in there to get you started.
- If you initialized this project with any other example contracts via `--with-example`, those contracts will be in the `contracts` directory as well.
- Contracts should have their own `Cargo.toml` files that rely on the top-level `Cargo.toml` workspace for their dependencies.
- Frontend libraries can be added to the top-level directory as well. If you initialized this project with a frontend template via `--frontend-template` you will have those files already included.
---

## ABI Reference — AutoShareContract

### Notification Category

Every event carries a `NotificationCategory` as its last indexed topic so off-chain consumers can subscribe to or filter whole categories without decoding the payload.

| Variant        | Value | Description                                             |
|----------------|-------|---------------------------------------------------------|
| `Group`        | 0     | AutoShare group lifecycle (created, updated, toggled)   |
| `Admin`        | 1     | Administrative actions (pause, unpause, admin transfer) |
| `Financial`    | 2     | Fund movements (withdrawals)                            |
| `Notification` | 3     | Scheduled notification operations (cancellation)        |

---

### Events

#### `scheduled_notification_cancelled`

Emitted whenever `cancel_notification` is called successfully.

**Topics** (in order):

| Index | Type                   | Description                                        |
|-------|------------------------|----------------------------------------------------|
| 0     | `Symbol`               | Event name: `"scheduled_notification_cancelled"`   |
| 1     | `Address`              | Address of the caller that triggered cancellation  |
| 2     | `NotificationCategory` | Always `Notification` (discriminant value `3`)     |

**Data** (`data_format = "single-value"`):

| Field              | Type         | Description                                       |
|--------------------|--------------|---------------------------------------------------|
| `notification_id`  | `BytesN<32>` | Unique identifier of the cancelled notification   |

**Example** (XDR topics decoded):
```
topics[0] = Symbol("scheduled_notification_cancelled")
topics[1] = Address("G...")       // caller
topics[2] = u32(3)                // NotificationCategory::Notification
data       = Bytes(32)            // notification_id
```

---

### Functions

#### `cancel_notification(notification_id: BytesN<32>, caller: Address)`

Cancels a scheduled notification and emits a `ScheduledNotificationCancelled` event on-chain.

- **Authentication**: `caller` must authorize the invocation (`caller.require_auth()`).
- **Paused check**: returns `ContractPaused` (error code 11) when the contract is paused.
- **State**: the contract does not maintain an internal registry of scheduled notifications; the `notification_id` is recorded solely in the emitted event.

**Parameters:**

| Name               | Type         | Description                              |
|--------------------|--------------|------------------------------------------|
| `notification_id`  | `BytesN<32>` | Identifier of the notification to cancel |
| `caller`           | `Address`    | Address authorizing the cancellation     |

**Errors:**

| Code | Variant          | Condition                          |
|------|------------------|------------------------------------|
| 11   | `ContractPaused` | Contract is currently paused       |
