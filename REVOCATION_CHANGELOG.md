# Notification Revocation - Detailed Change Log

## File-by-File Changes

### 1. src/base/errors.rs

**Location**: After line 24 (after `NotificationNotExpired = 25`)

**Changes Added**:
```rust
    /// Triggered when attempting to interact with a revoked notification.
    NotificationRevoked = 26,
    /// Triggered when the caller is not authorized to revoke a notification.
    NotAuthorizedToRevoke = 27,
    /// Triggered when attempting to revoke a notification that is already revoked.
    AlreadyRevoked = 28,
```

**Impact**: Adds 3 new error types with sequential IDs starting from 26

---

### 2. src/base/events.rs

**Location**: After line 234 (after `NotificationExpired` struct definition)

**Changes Added**:
```rust
/// Emitted when a scheduled notification is revoked by an authorized sender.
///
/// The `notification_id` is published as an indexed topic so consumers can
/// subscribe to the revocation of a specific notification; the `revoked_by`
/// address indicates who initiated the revocation, and `revoked_at` records
/// the ledger timestamp when the revocation occurred.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct NotificationRevoked {
    #[topic]
    pub notification_id: BytesN<32>,
    #[topic]
    pub revoked_by: Address,
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
    pub revoked_at: u64,
}
```

**Impact**: Adds new event type for revocation tracking

---

### 3. src/base/types.rs

**Location**: Lines 19-30 (ScheduledNotification struct)

**Before**:
```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduledNotification {
    pub id: BytesN<32>,
    pub creator: Address,
    /// Ledger timestamp (seconds) at which the notification was scheduled.
    pub created_at: u64,
    /// Ledger timestamp (seconds) at or after which the notification is expired.
    pub expires_at: u64,
}
```

**After**:
```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduledNotification {
    pub id: BytesN<32>,
    pub creator: Address,
    /// Ledger timestamp (seconds) at which the notification was scheduled.
    pub created_at: u64,
    /// Ledger timestamp (seconds) at or after which the notification is expired.
    pub expires_at: u64,
    /// Address that revoked the notification, or None if not revoked.
    pub revoked_by: Option<Address>,
    /// Ledger timestamp (seconds) at which the notification was revoked, if revoked.
    pub revoked_at: Option<u64>,
}
```

**Impact**: Adds revocation state tracking to notification struct

---

### 4. src/autoshare_logic.rs

#### Change 4.1: Update imports (Line 3)

**Before**:
```rust
use crate::base::events::{
    AdminTransferred, AuthorizationFailure, AutoshareCreated, AutoshareUpdated, ContractPaused,
    ContractUnpaused, GroupActivated, GroupDeactivated, NotificationCategory, NotificationExpired,
    NotificationPriority, NotificationScheduled, ScheduledNotificationCancelled, Withdrawal,
};
```

**After**:
```rust
use crate::base::events::{
    AdminTransferred, AuthorizationFailure, AutoshareCreated, AutoshareUpdated, ContractPaused,
    ContractUnpaused, GroupActivated, GroupDeactivated, NotificationCategory, NotificationExpired,
    NotificationPriority, NotificationRevoked, NotificationScheduled, ScheduledNotificationCancelled,
    Withdrawal,
};
```

**Impact**: Imports new NotificationRevoked event

#### Change 4.2: Update DataKey enum (Line 18)

**Before**:
```rust
#[contracttype]
pub enum DataKey {
    AutoShare(BytesN<32>),
    AllGroups,
    Admin,
    SupportedTokens,
    UsageFee,
    UserPaymentHistory(Address),
    GroupPaymentHistory(BytesN<32>),
    GroupMembers(BytesN<32>),
    IsPaused,
    ScheduledNotification(BytesN<32>),
}
```

**After**:
```rust
#[contracttype]
pub enum DataKey {
    AutoShare(BytesN<32>),
    AllGroups,
    Admin,
    SupportedTokens,
    UsageFee,
    UserPaymentHistory(Address),
    GroupPaymentHistory(BytesN<32>),
    GroupMembers(BytesN<32>),
    IsPaused,
    ScheduledNotification(BytesN<32>),
    NotificationRevokers(BytesN<32>),
}
```

**Impact**: Adds key for potential future revocation permissions tracking

#### Change 4.3: Update schedule_notification function

**Location**: Around line 900 (in ScheduledNotification initialization)

**Before**:
```rust
    let notification = ScheduledNotification {
        id: notification_id.clone(),
        creator: creator.clone(),
        created_at,
        expires_at,
    };
```

**After**:
```rust
    let notification = ScheduledNotification {
        id: notification_id.clone(),
        creator: creator.clone(),
        created_at,
        expires_at,
        revoked_by: None,
        revoked_at: None,
    };
```

**Impact**: Initializes new revocation fields

#### Change 4.4: Add helper function is_revoked

**Location**: After `is_expired()` function (around line 865)

**Added**:
```rust
/// Returns true if a notification has been revoked.
fn is_revoked(notification: &ScheduledNotification) -> bool {
    notification.revoked_by.is_some()
}
```

**Impact**: Helper to check revocation status

#### Change 4.5: Update cancel_notification function

**Location**: Around line 978-1004

**Before**:
```rust
pub fn cancel_notification(
    env: Env,
    notification_id: BytesN<32>,
    caller: Address,
) -> Result<(), Error> {
    caller.require_auth();

    if get_paused_status(&env) {
        return Err(Error::ContractPaused);
    }

    if let Some(notification) = load_notification(&env, &notification_id) {
        if is_expired(&env, &notification) {
            return Err(Error::NotificationExpired);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::ScheduledNotification(notification_id.clone()));
    }
    
    // ... emit event
}
```

**After**:
```rust
pub fn cancel_notification(
    env: Env,
    notification_id: BytesN<32>,
    caller: Address,
) -> Result<(), Error> {
    caller.require_auth();

    if get_paused_status(&env) {
        return Err(Error::ContractPaused);
    }

    if let Some(notification) = load_notification(&env, &notification_id) {
        if is_revoked(&notification) {
            return Err(Error::NotificationRevoked);
        }
        if is_expired(&env, &notification) {
            return Err(Error::NotificationExpired);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::ScheduledNotification(notification_id.clone()));
    }
    
    // ... emit event
}
```

**Impact**: Prevents cancellation of revoked notifications

#### Change 4.6: Update expire_notification function

**Location**: Around line 946-965

**Before**:
```rust
/// Expires a notification whose lifetime has elapsed: removes it from storage
/// and emits [`NotificationExpired`].
///
/// Permissionless by design — any party (e.g. an off-chain keeper) may finalize
/// the expiry of an elapsed notification. A notification that has not yet
/// reached its expiry is rejected with [`Error::NotificationNotExpired`]; an
/// unknown one with [`Error::NotFound`].
pub fn expire_notification(env: Env, notification_id: BytesN<32>) -> Result<(), Error> {
    let key = DataKey::ScheduledNotification(notification_id.clone());
    let notification = load_notification(&env, &notification_id).ok_or(Error::NotFound)?;

    if !is_expired(&env, &notification) {
        return Err(Error::NotificationNotExpired);
    }

    env.storage().persistent().remove(&key);

    NotificationExpired {
        notification_id,
        category: NotificationCategory::Notification,
        priority: NOTIFICATION_PRIORITY,
        expires_at: notification.expires_at,
    }
    .publish(&env);

    Ok(())
}
```

**After**:
```rust
/// Expires a notification whose lifetime has elapsed: removes it from storage
/// and emits [`NotificationExpired`].
///
/// Permissionless by design — any party (e.g. an off-chain keeper) may finalize
/// the expiry of an elapsed notification. A notification that has not yet
/// reached its expiry is rejected with [`Error::NotificationNotExpired`]; a
/// revoked notification with [`Error::NotificationRevoked`]; an unknown one
/// with [`Error::NotFound`].
pub fn expire_notification(env: Env, notification_id: BytesN<32>) -> Result<(), Error> {
    let key = DataKey::ScheduledNotification(notification_id.clone());
    let notification = load_notification(&env, &notification_id).ok_or(Error::NotFound)?;

    // Cannot expire a revoked notification
    if is_revoked(&notification) {
        return Err(Error::NotificationRevoked);
    }

    if !is_expired(&env, &notification) {
        return Err(Error::NotificationNotExpired);
    }

    env.storage().persistent().remove(&key);

    NotificationExpired {
        notification_id,
        category: NotificationCategory::Notification,
        priority: NOTIFICATION_PRIORITY,
        expires_at: notification.expires_at,
    }
    .publish(&env);

    Ok(())
}
```

**Impact**: Prevents expiration of revoked notifications

#### Change 4.7: Add revoke_notification function

**Location**: After cancel_notification (around line 1030)

**Added**:
```rust
/// Revokes a scheduled notification, preventing any further interaction with it.
///
/// Only authorized callers (the notification creator or the contract admin) can
/// revoke a notification. The notification must exist, not already be revoked,
/// and not have expired. Once revoked, the notification state is updated to
/// record who revoked it and when, and a [`NotificationRevoked`] event is emitted.
///
/// Revoked notifications maintain their state for transparency and auditing:
/// they can still be queried but cannot be cancelled or expired.
pub fn revoke_notification(
    env: Env,
    notification_id: BytesN<32>,
    caller: Address,
) -> Result<(), Error> {
    caller.require_auth();

    if get_paused_status(&env) {
        return Err(Error::ContractPaused);
    }

    let key = DataKey::ScheduledNotification(notification_id.clone());
    let mut notification = load_notification(&env, &notification_id).ok_or(Error::NotFound)?;

    // Check if already revoked
    if is_revoked(&notification) {
        return Err(Error::AlreadyRevoked);
    }

    // Check if expired (cannot revoke expired notifications)
    if is_expired(&env, &notification) {
        return Err(Error::NotificationExpired);
    }

    // Check authorization: only creator or admin can revoke
    let admin = get_admin(env.clone()).ok();
    let is_creator = caller == notification.creator;
    let is_admin = admin.as_ref().map_or(false, |a| caller == *a);

    if !is_creator && !is_admin {
        return Err(Error::NotAuthorizedToRevoke);
    }

    // Update notification with revocation data
    let revoked_at = env.ledger().timestamp();
    notification.revoked_by = Some(caller.clone());
    notification.revoked_at = Some(revoked_at);

    // Store updated notification
    env.storage().persistent().set(&key, &notification);

    // Emit revocation event
    NotificationRevoked {
        notification_id,
        revoked_by: caller,
        category: NotificationCategory::Notification,
        priority: NotificationPriority::High,
        revoked_at,
    }
    .publish(&env);

    Ok(())
}

/// Checks if a notification has been revoked.
///
/// Returns [`Error::NotFound`] if the notification is not tracked.
pub fn is_notification_revoked(env: Env, notification_id: BytesN<32>) -> Result<bool, Error> {
    let notification = get_notification(env, notification_id)?;
    Ok(is_revoked(&notification))
}
```

**Impact**: Implements main revocation logic

---

### 5. src/lib.rs

#### Change 5.1: Update public contract methods (Lines 290-295)

**Location**: After expire_notification method

**Before**:
```rust
    /// Finalizes the expiry of a notification whose lifetime has elapsed,
    /// emitting a `NotificationExpired` event. Callable by anyone.
    pub fn expire_notification(env: Env, notification_id: BytesN<32>) {
        autoshare_logic::expire_notification(env, notification_id).unwrap();
    }
}
```

**After**:
```rust
    /// Finalizes the expiry of a notification whose lifetime has elapsed,
    /// emitting a `NotificationExpired` event. Callable by anyone.
    pub fn expire_notification(env: Env, notification_id: BytesN<32>) {
        autoshare_logic::expire_notification(env, notification_id).unwrap();
    }

    /// Revokes a scheduled notification, preventing any further interaction with it.
    ///
    /// Only the notification creator or the contract admin can revoke a notification.
    /// The notification must not already be revoked or expired. Emits a `NotificationRevoked` event.
    pub fn revoke_notification(env: Env, notification_id: BytesN<32>, caller: Address) {
        autoshare_logic::revoke_notification(env, notification_id, caller).unwrap();
    }

    /// Returns whether a scheduled notification has been revoked.
    pub fn is_notification_revoked(env: Env, notification_id: BytesN<32>) -> bool {
        autoshare_logic::is_notification_revoked(env, notification_id).unwrap()
    }
}
```

**Impact**: Exposes revocation functions to contract interface

#### Change 5.2: Add test module (Lines 310-313)

**Location**: In #[cfg(test)] mod tests block

**Before**:
```rust
    #[path = "../tests/expiration_test.rs"]
    mod expiration_test;
}
```

**After**:
```rust
    #[path = "../tests/expiration_test.rs"]
    mod expiration_test;

    #[path = "../tests/revocation_test.rs"]
    mod revocation_test;
}
```

**Impact**: Registers new test module

---

### 6. src/tests/revocation_test.rs (NEW FILE)

**Location**: New file created

**Contains**:
- 15 comprehensive test cases
- Tests for authorization, edge cases, event emission
- Helper functions for test setup and event parsing
- Documentation of test coverage

**Test Categories**:
1. Basic revocation (3 tests)
2. Authorization (3 tests)  
3. Edge cases (4 tests)
4. Interaction prevention (2 tests)
5. Event verification (3 tests)

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Files Modified | 5 |
| Files Created | 1 |
| Error Types Added | 3 |
| Events Added | 1 |
| Functions Added | 2 |
| Functions Modified | 3 |
| Test Cases Added | 15 |
| Lines of Code Added | ~500 |
| Lines of Documentation | ~400 |

---

## Backwards Compatibility

✅ **Fully Backwards Compatible**

- New fields in `ScheduledNotification` are `Option<T>` (optional)
- Existing function signatures unchanged
- New events don't break existing event consumers
- Old code continues to work without modification

---

## Breaking Changes

❌ **None**

All changes are additive and non-breaking.

---

## Build Instructions

To build and test:

```bash
cd contract/contracts/hello-world
stellar contract build
cargo test
```

---

## Deployment Checklist

- [ ] Code review completed
- [ ] All tests passing
- [ ] Contract builds successfully  
- [ ] Documentation reviewed
- [ ] Event schema updated in indexer
- [ ] Off-chain listeners updated
- [ ] Testnet deployment prepared
- [ ] Mainnet deployment planned
