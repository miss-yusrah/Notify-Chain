//! Tests for notification revocation mechanism (issue #176).
//!
//! These cover the full lifecycle of notification revocation:
//! - authorized callers (creator and admin) can revoke notifications,
//! - revoked notifications cannot be cancelled or expired,
//! - revocation updates the notification state with who revoked it and when,
//! - the revocation event is emitted correctly,
//! - authorization checks prevent unauthorized revocation,
//! - edge cases like already-revoked and expired notifications are handled.

use crate::base::events::NotificationCategory;
use crate::test_utils::setup_test_env;
use crate::AutoShareContractClient;

use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::{Address, BytesN, Env, Symbol, TryFromVal, Val, Vec};

/// One hour, in seconds — a representative configurable duration.
const ONE_HOUR: u64 = 3_600;

fn make_id(env: &Env, tag: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = tag;
    BytesN::from_array(env, &bytes)
}

/// Sets the ledger clock to an absolute timestamp (seconds).
fn set_now(env: &Env, timestamp: u64) {
    env.ledger().set_timestamp(timestamp);
}

/// Returns the topic list of the most recently emitted event whose first topic
/// matches `event_name` (the snake_case name produced by `#[contractevent]`).
fn topics_of(env: &Env, event_name: &str) -> Option<Vec<Val>> {
    let target = Symbol::new(env, event_name);
    let mut found: Option<Vec<Val>> = None;
    for (_addr, topics, _data) in env.events().all().iter() {
        if topics.is_empty() {
            continue;
        }
        let first = topics.get(0).unwrap();
        if let Ok(name) = Symbol::try_from_val(env, &first) {
            if name == target {
                found = Some(topics);
            }
        }
    }
    found
}

/// Returns the data payload of the latest event named `event_name`.
fn data_of(env: &Env, event_name: &str) -> Option<Val> {
    let target = Symbol::new(env, event_name);
    let mut found: Option<Val> = None;
    for (_addr, topics, data) in env.events().all().iter() {
        if topics.is_empty() {
            continue;
        }
        let first = topics.get(0).unwrap();
        if let Ok(name) = Symbol::try_from_val(env, &first) {
            if name == target {
                found = Some(data);
            }
        }
    }
    found
}

#[test]
fn test_revoke_notification_by_creator() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 1);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    // Verify notification is still stored but marked as revoked
    let notification = client.get_notification(&id);
    assert!(notification.revoked_by.is_some());
    assert_eq!(notification.revoked_by.unwrap(), creator);
    assert!(notification.revoked_at.is_some());
    assert_eq!(notification.revoked_at.unwrap(), 2_000);
}

#[test]
fn test_is_notification_revoked_after_revocation() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 2);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    assert!(!client.is_notification_revoked(&id));

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    assert!(client.is_notification_revoked(&id));
}

#[test]
fn test_revoke_notification_emits_event() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 3);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    let topics = topics_of(&test_env.env, "notification_revoked").expect("revocation event must be emitted");
    // [0] name, [1] notification_id, [2] revoked_by, [3] category, [4] priority.
    assert_eq!(topics.len(), 5);

    let topic_id = BytesN::<32>::try_from_val(&test_env.env, &topics.get(1).unwrap()).unwrap();
    assert_eq!(topic_id, id);

    let topic_revoked_by = Address::try_from_val(&test_env.env, &topics.get(2).unwrap()).unwrap();
    assert_eq!(topic_revoked_by, creator);
}

#[test]
#[should_panic]
fn test_revoke_by_unauthorized_user_fails() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let unauthorized = Address::generate(&test_env.env);

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 4);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &unauthorized);
}

#[test]
#[should_panic]
fn test_cannot_revoke_already_revoked_notification() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 5);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    // Try to revoke again
    set_now(&test_env.env, 3_000);
    client.revoke_notification(&id, &creator);
}

#[test]
#[should_panic]
fn test_cannot_revoke_expired_notification() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 6);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Skip past expiration
    set_now(&test_env.env, 1_000 + ONE_HOUR + 1);

    // Try to revoke an expired notification
    client.revoke_notification(&id, &creator);
}

#[test]
#[should_panic]
fn test_cannot_revoke_nonexistent_notification() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let caller = Address::generate(&test_env.env);

    let id = make_id(&test_env.env, 7);

    // Try to revoke a notification that doesn't exist
    client.revoke_notification(&id, &caller);
}

#[test]
#[should_panic]
fn test_cannot_cancel_revoked_notification() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 8);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    // Try to cancel the revoked notification
    set_now(&test_env.env, 3_000);
    client.cancel_notification(&id, &creator);
}

#[test]
#[should_panic]
fn test_cannot_expire_revoked_notification() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 9);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    // Skip past the expiration time to make expire_notification technically eligible
    set_now(&test_env.env, 1_000 + ONE_HOUR + 1);

    // Try to expire the revoked notification
    client.expire_notification(&id);
}

#[should_panic]
fn test_revoke_notification_while_contract_paused_fails() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let admin = test_env.admin.clone();
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 10);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Pause the contract
    client.pause(&admin);

    set_now(&test_env.env, 2_000);
    // Try to revoke while paused (should panic / fail)
    client.revoke_notification(&id, &creator);
}

#[test]
fn test_revoke_notification_by_admin() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let admin = test_env.admin.clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 11);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    // Admin revokes notification created by someone else
    client.revoke_notification(&id, &admin);

    let notification = client.get_notification(&id);
    assert_eq!(notification.revoked_by.unwrap(), admin);
}

#[test]
fn test_revocation_stores_timestamp() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 12);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    let notification = client.get_notification(&id);
    assert_eq!(notification.revoked_at.unwrap(), 2_000);
}

#[test]
fn test_revoked_notification_still_queryable() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 13);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Revoke it
    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    // Should still be able to retrieve it
    let notification = client.get_notification(&id);
    assert_eq!(notification.id, id);
    assert_eq!(notification.creator, creator);
    assert!(notification.revoked_by.is_some());

    // isNotificationRevoked should return true
    assert!(client.is_notification_revoked(&id));
}

#[test]
fn test_revoke_event_has_high_priority() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 14);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    let topics = topics_of(&test_env.env, "notification_revoked").expect("revocation event must be emitted");
    // Last topic is priority
    let priority_topic = topics.last().unwrap();
    let priority = crate::base::events::NotificationPriority::try_from_val(&test_env.env, &priority_topic)
        .expect("priority should be extractable");
    
    assert_eq!(priority, crate::base::events::NotificationPriority::High);
}

#[test]
fn test_revoke_event_has_notification_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 15);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, 2_000);
    client.revoke_notification(&id, &creator);

    let topics = topics_of(&test_env.env, "notification_revoked").expect("revocation event must be emitted");
    // Second to last topic is category
    let n = topics.len();
    let category_topic = topics.get(n - 2).unwrap();
    let category = NotificationCategory::try_from_val(&test_env.env, &category_topic)
        .expect("category should be extractable");
    
    assert_eq!(category, NotificationCategory::Notification);
}
