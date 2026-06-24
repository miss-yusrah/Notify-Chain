# Notification Revocation - Quick Reference Guide

## Public API

### Revoke a Notification

```rust
pub fn revoke_notification(env: Env, notification_id: BytesN<32>, caller: Address)
```

**Parameters:**
- `notification_id`: The ID of the notification to revoke
- `caller`: The address performing the revocation (must be authenticated)

**Authentication:** Required - caller must be authenticated

**Authorization:** Only notification creator or contract admin

**Returns:** `Result<(), Error>`

**Possible Errors:**
- `ContractPaused` - Contract is currently paused
- `NotFound` - Notification with this ID doesn't exist
- `NotificationRevoked` - Notification is already revoked
- `NotificationExpired` - Notification has expired (cannot revoke)
- `NotAuthorizedToRevoke` - Caller is not creator or admin

**Example:**
```rust
let notification_id = BytesN::from_array(&env, &[1u8; 32]);
let creator = Address::generate(&env);

// Creator revoking their own notification
client.revoke_notification(&notification_id, &creator);

// Admin revoking any notification
let admin = client.get_admin();
client.revoke_notification(&notification_id, &admin);
```

---

### Check if Notification is Revoked

```rust
pub fn is_notification_revoked(env: Env, notification_id: BytesN<32>) -> bool
```

**Parameters:**
- `notification_id`: The ID of the notification to check

**Returns:** `bool` - true if revoked, false if not

**Possible Errors:**
- `NotFound` - Notification with this ID doesn't exist

**Example:**
```rust
if client.is_notification_revoked(&notification_id) {
    println!("Notification is revoked");
} else {
    println!("Notification is still active");
}
```

---

### Get Notification Details (Including Revocation Status)

```rust
pub fn get_notification(env: Env, notification_id: BytesN<32>) -> ScheduledNotification
```

**Returns:** `ScheduledNotification` struct with these fields:
- `id: BytesN<32>` - Notification ID
- `creator: Address` - Who created the notification
- `created_at: u64` - Ledger timestamp when created
- `expires_at: u64` - Ledger timestamp when it expires
- `revoked_by: Option<Address>` - Who revoked it (None if not revoked)
- `revoked_at: Option<u64>` - When it was revoked in ledger seconds

**Example:**
```rust
let notification = client.get_notification(&notification_id);

println!("Created by: {}", notification.creator);
println!("Expires at: {}", notification.expires_at);

if let Some(revoked_by) = notification.revoked_by {
    println!("Revoked by: {} at timestamp {}", 
             revoked_by, 
             notification.revoked_at.unwrap());
}
```

---

## Revocation Workflow

### Basic Flow

```
1. Schedule Notification
   └─> client.schedule_notification(id, creator, ttl_seconds)

2. Later: Decide to Revoke
   └─> client.revoke_notification(id, caller)
       - caller must be creator or admin
       - notification must exist and not be expired

3. Check Status
   └─> is_revoked = client.is_notification_revoked(id)

4. Try to Cancel (will fail)
   └─> client.cancel_notification(id, caller)
       └─> ❌ Error::NotificationRevoked
```

### State Transitions

```
┌─────────────────────────────────────────┐
│      Notification Lifecycle             │
└─────────────────────────────────────────┘

      schedule_notification()
             │
             ▼
    ┌────────────────┐
    │    Scheduled   │
    └────────────────┘
      │              │
      │        revoke_notification()
      │              │
      │              ▼
      │    ┌──────────────────┐
      │    │     Revoked      │
      │    │ (Permanent)      │
      │    └──────────────────┘
      │         │
      │    Can't Cancel ❌
      │    Can't Expire ❌
      │    Can Query ✓
      │    
Wait  │
TTL   │
      ▼
    ┌────────────────┐
    │    Expired     │
    └────────────────┘
      │
expire_notification()
      │
      ▼
    ┌────────────────┐
    │    Removed     │
    │   (Reaped)     │
    └────────────────┘
```

---

## Error Handling

### Authorization Error
```rust
match client.revoke_notification(&id, &unauthorized_user) {
    Err(Error::NotAuthorizedToRevoke) => {
        println!("Only creator or admin can revoke");
    },
    _ => {}
}
```

### Already Revoked Error
```rust
// First revocation succeeds
client.revoke_notification(&id, &creator)?;

// Second revocation fails
match client.revoke_notification(&id, &creator) {
    Err(Error::AlreadyRevoked) => {
        println!("Notification is already revoked");
    },
    _ => {}
}
```

### Expired Notification Error
```rust
// Schedule with short TTL
client.schedule_notification(&id, &creator, &10)?; // 10 seconds

// Wait for expiration...
// env.ledger().set_timestamp(start_time + 20);

// Try to revoke - will fail
match client.revoke_notification(&id, &creator) {
    Err(Error::NotificationExpired) => {
        println!("Cannot revoke - notification already expired");
    },
    _ => {}
}
```

---

## Events

### NotificationRevoked Event

Emitted when a notification is successfully revoked.

**Topics (indexed for filtering):**
1. Event name: `notification_revoked`
2. `notification_id` (BytesN<32>) - Which notification was revoked
3. `revoked_by` (Address) - Who performed the revocation
4. `category` (NotificationCategory) - Always `Notification`
5. `priority` (NotificationPriority) - Always `High` (security-relevant)

**Data:**
- `revoked_at` (u64) - Ledger timestamp of revocation

**Example Event Listener:**
```javascript
// Off-chain listener example (pseudo-code)
contract.on('notification_revoked', (event) => {
    console.log(`Notification ${event.notification_id} revoked`);
    console.log(`Revoked by: ${event.revoked_by}`);
    console.log(`At timestamp: ${event.revoked_at}`);
    
    // Route to alerting system (high priority)
    alertSystem.sendAlert({
        type: 'revocation',
        notification_id: event.notification_id,
        revoked_by: event.revoked_by,
        timestamp: event.revoked_at
    });
});
```

---

## Authorization Rules

### Who Can Revoke?

```
┌─────────────────────────────────────┐
│ Can Revoke Any Notification         │
│ ✓ Contract Admin                    │
│                                     │
│ Can Revoke Their Own Notifications  │
│ ✓ Notification Creator              │
│                                     │
│ Cannot Revoke                       │
│ ✗ Other addresses                   │
│ ✗ Group members (not creators)      │
│ ✗ Payment payers                    │
└─────────────────────────────────────┘
```

### Example: Admin Override

```rust
let admin = client.get_admin();
let notification_creator = Address::generate(&env);
let notification_id = BytesN::from_array(&env, &[1u8; 32]);

// Creator schedules notification
client.schedule_notification(&notification_id, &notification_creator, &3600);

// Admin can revoke it even though they didn't create it
client.revoke_notification(&notification_id, &admin)?; // ✓ Works

// But non-admin can't
let hacker = Address::generate(&env);
client.revoke_notification(&notification_id, &hacker); // ✗ Error::NotAuthorizedToRevoke
```

---

## Contract Pause Interaction

Revocation is blocked while contract is paused:

```rust
// Revocation works normally
client.revoke_notification(&id, &creator)?; // ✓ OK

// Pause contract
client.pause(&admin);

// Try to revoke while paused
client.revoke_notification(&id2, &creator); // ✗ Error::ContractPaused

// Unpause
client.unpause(&admin);

// Now revocation works again
client.revoke_notification(&id2, &creator)?; // ✓ OK
```

---

## Integration Examples

### Checking Before Interaction

```rust
// Before using a notification
pub fn use_notification(env: Env, notification_id: BytesN<32>) {
    // Check if notification is revoked
    if client.is_notification_revoked(&notification_id) {
        return Error::NotificationRevoked;
    }
    
    // Check if expired
    if client.is_notification_expired(&notification_id) {
        return Error::NotificationExpired;
    }
    
    // Now safe to use
    process_notification(&notification_id);
}
```

### Audit Trail Query

```rust
// Get full notification details for auditing
let notification = client.get_notification(&id);

let audit_record = AuditLog {
    id: notification.id,
    creator: notification.creator,
    created_at: notification.created_at,
    expires_at: notification.expires_at,
    status: if notification.revoked_by.is_some() {
        "Revoked"
    } else {
        "Active"
    },
    revoked_by: notification.revoked_by,
    revoked_at: notification.revoked_at,
};

audit_log.record(audit_record);
```

---

## Common Patterns

### Pattern 1: Safe Notification Retrieval

```rust
fn safely_get_notification(
    client: &AutoShareContractClient,
    notification_id: &BytesN<32>
) -> Result<ScheduledNotification, Error> {
    let notification = client.get_notification(notification_id)?;
    
    // Check revocation
    if notification.revoked_by.is_some() {
        return Err(Error::NotificationRevoked);
    }
    
    Ok(notification)
}
```

### Pattern 2: Revoke with Logging

```rust
fn revoke_with_audit(
    client: &AutoShareContractClient,
    notification_id: BytesN<32>,
    revoker: Address,
    reason: String
) -> Result<(), Error> {
    // Log before revocation
    audit_log.record_action("revoke_initiated", &revoker, &reason);
    
    // Perform revocation
    client.revoke_notification(&notification_id, &revoker)?;
    
    // Log success
    audit_log.record_action("revoke_success", &revoker, &reason);
    
    Ok(())
}
```

### Pattern 3: Batch Revocation Check

```rust
fn get_active_notifications(
    client: &AutoShareContractClient,
    ids: &Vec<BytesN<32>>
) -> Vec<ScheduledNotification> {
    ids.iter()
        .filter_map(|id| {
            if let Ok(notif) = client.get_notification(id) {
                if notif.revoked_by.is_none() {
                    return Some(notif);
                }
            }
            None
        })
        .collect()
}
```

---

## Testing

### Unit Test Example

```rust
#[test]
fn test_my_revocation_logic() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.contract);
    let creator = test_env.users[0].clone();
    
    // Create notification
    let id = make_id(&test_env.env, 1);
    client.schedule_notification(&id, &creator, &3600);
    assert!(!client.is_notification_revoked(&id));
    
    // Revoke it
    client.revoke_notification(&id, &creator);
    assert!(client.is_notification_revoked(&id));
    
    // Verify can't cancel
    let result = std::panic::catch_unwind(|| {
        client.cancel_notification(&id, &creator);
    });
    assert!(result.is_err());
}
```

---

## Performance Notes

- **Revocation Time**: O(1) - Direct storage update
- **Query Time**: O(1) - Direct storage read
- **Storage Cost**: +2 fields (Option<Address>, Option<u64>) per notification
- **Event Cost**: Standard event emission

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `NotAuthorizedToRevoke` | Not creator or admin | Ensure caller is creator or get admin address |
| `NotFound` | ID doesn't exist | Verify notification was created first |
| `AlreadyRevoked` | Trying to revoke twice | Check `is_notification_revoked()` first |
| `NotificationExpired` | Past expiration time | Can only revoke active notifications |
| `ContractPaused` | Contract is paused | Wait for unpause or have admin unpause |

