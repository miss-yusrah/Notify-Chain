//! Tests for on-chain notification expiration (issue #128).
//!
//! These cover the full lifecycle of a scheduled notification:
//! - scheduling stores a bounded lifetime and emits `NotificationScheduled`,
//! - an elapsed notification is *invalid* — it can't be cancelled and reports as
//!   expired,
//! - finalizing expiry removes the record and emits `NotificationExpired`,
//! - the configurable duration is validated, and pausing blocks scheduling.

use crate::base::events::NotificationCategory;
use crate::test_utils::setup_test_env;
use crate::AutoShareContractClient;

use soroban_sdk::testutils::{Events, Ledger};
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
fn test_schedule_stores_created_and_expiry() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 1);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    let stored = client.get_notification(&id);
    assert_eq!(stored.id, id);
    assert_eq!(stored.creator, creator);
    assert_eq!(stored.created_at, 1_000);
    assert_eq!(stored.expires_at, 1_000 + ONE_HOUR);
}

#[test]
fn test_schedule_emits_notification_scheduled_event() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    let id = make_id(&test_env.env, 2);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    let topics = topics_of(&test_env.env, "notification_scheduled").expect("event must be emitted");
    // [0] name, [1] creator, [2] category, [3] priority.
    assert_eq!(topics.len(), 4);

    let topic_creator = Address::try_from_val(&test_env.env, &topics.get(1).unwrap()).unwrap();
    assert_eq!(topic_creator, creator);

    let category =
        NotificationCategory::try_from_val(&test_env.env, &topics.get(2).unwrap()).unwrap();
    assert_eq!(category, NotificationCategory::Notification);

    // Data payload carries the notification id.
    let data = data_of(&test_env.env, "notification_scheduled").unwrap();
    let data_id = BytesN::<32>::try_from_val(&test_env.env, &data).unwrap();
    assert_eq!(data_id, id);
}

#[test]
fn test_not_expired_before_deadline_and_expired_after() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 3);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Just before the deadline: still valid.
    set_now(&test_env.env, 1_000 + ONE_HOUR - 1);
    assert!(!client.is_notification_expired(&id));

    // At the deadline: expired (boundary is inclusive).
    set_now(&test_env.env, 1_000 + ONE_HOUR);
    assert!(client.is_notification_expired(&id));

    // Well past the deadline: still expired.
    set_now(&test_env.env, 1_000 + ONE_HOUR + 10_000);
    assert!(client.is_notification_expired(&id));
}

#[test]
fn test_zero_duration_is_rejected() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    let id = make_id(&test_env.env, 4);
    let result = client.try_schedule_notification(&id, &creator, &0);
    assert!(
        result.is_err(),
        "a zero expiration duration must be rejected"
    );
}

#[test]
fn test_duplicate_schedule_is_rejected() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    let id = make_id(&test_env.env, 5);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    let result = client.try_schedule_notification(&id, &creator, &ONE_HOUR);
    assert!(
        result.is_err(),
        "scheduling a duplicate id must be rejected"
    );
}

#[test]
fn test_get_unknown_notification_fails() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

    let id = make_id(&test_env.env, 6);
    assert!(client.try_get_notification(&id).is_err());
    assert!(client.try_is_notification_expired(&id).is_err());
}

#[test]
fn test_expired_notification_cannot_be_cancelled() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 500);
    let id = make_id(&test_env.env, 7);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Before expiry, cancellation succeeds for a fresh (different) notification.
    let fresh = make_id(&test_env.env, 8);
    client.schedule_notification(&fresh, &creator, &ONE_HOUR);
    client.cancel_notification(&fresh, &creator);
    // Cancelling reaps the record.
    assert!(client.try_get_notification(&fresh).is_err());

    // After expiry, the original notification is invalid and cannot be cancelled.
    set_now(&test_env.env, 500 + ONE_HOUR + 1);
    let result = client.try_cancel_notification(&id, &creator);
    assert!(
        result.is_err(),
        "an expired notification must not be cancellable"
    );
}

#[test]
fn test_expire_before_deadline_is_rejected() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 1_000);
    let id = make_id(&test_env.env, 9);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    // Not yet elapsed — finalizing expiry must be rejected.
    set_now(&test_env.env, 1_000 + ONE_HOUR - 1);
    assert!(client.try_expire_notification(&id).is_err());

    // The notification is still present and valid.
    assert!(!client.is_notification_expired(&id));
}

#[test]
fn test_expire_after_deadline_emits_event_and_reaps_storage() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 2_000);
    let id = make_id(&test_env.env, 10);
    let expected_expiry = 2_000 + ONE_HOUR;
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    set_now(&test_env.env, expected_expiry);
    client.expire_notification(&id);

    // Event shape: [0] name, [1] notification_id, [2] category, [3] priority.
    let topics = topics_of(&test_env.env, "notification_expired").expect("event must be emitted");
    assert_eq!(topics.len(), 4);

    let topic_id = BytesN::<32>::try_from_val(&test_env.env, &topics.get(1).unwrap()).unwrap();
    assert_eq!(topic_id, id);

    let category =
        NotificationCategory::try_from_val(&test_env.env, &topics.get(2).unwrap()).unwrap();
    assert_eq!(category, NotificationCategory::Notification);

    // Data payload is the expiry timestamp.
    let data = data_of(&test_env.env, "notification_expired").unwrap();
    let data_expiry = u64::try_from_val(&test_env.env, &data).unwrap();
    assert_eq!(data_expiry, expected_expiry);

    // Storage was reaped: the notification no longer exists.
    assert!(client.try_get_notification(&id).is_err());
}

#[test]
fn test_expire_unknown_notification_fails() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

    let id = make_id(&test_env.env, 11);
    assert!(client.try_expire_notification(&id).is_err());
}

#[test]
fn test_schedule_blocked_when_contract_paused() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    client.pause(&test_env.admin);

    let id = make_id(&test_env.env, 12);
    let result = client.try_schedule_notification(&id, &creator, &ONE_HOUR);
    assert!(
        result.is_err(),
        "scheduling must be rejected while the contract is paused"
    );
}

#[test]
fn test_valid_notification_can_be_cancelled_and_emits_event() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();

    set_now(&test_env.env, 100);
    let id = make_id(&test_env.env, 13);
    client.schedule_notification(&id, &creator, &ONE_HOUR);

    client.cancel_notification(&id, &creator);

    assert!(
        topics_of(&test_env.env, "scheduled_notification_cancelled").is_some(),
        "cancellation event must be emitted"
    );
    // The record is reaped on cancellation.
    assert!(client.try_get_notification(&id).is_err());
}

#[test]
fn test_cancelling_untracked_id_still_emits_event() {
    // Backward compatibility: ids that were never scheduled on-chain can still be
    // cancelled (signalling cancellation of an off-chain-managed notification).
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let caller = test_env.users.get(0).unwrap().clone();

    let id = make_id(&test_env.env, 14);
    client.cancel_notification(&id, &caller);

    assert!(
        topics_of(&test_env.env, "scheduled_notification_cancelled").is_some(),
        "cancelling an untracked id must still emit the event"
    );
}

#[test]
fn test_cancellation_blocked_when_contract_paused() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let caller = test_env.users.get(0).unwrap().clone();

    client.pause(&test_env.admin);

    let id = make_id(&test_env.env, 15);
    let result = client.try_cancel_notification(&id, &caller);
    assert!(
        result.is_err(),
        "cancellation must be rejected while the contract is paused"
    );
}
