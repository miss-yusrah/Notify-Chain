//! Tests for notification category metadata attached to emitted events.
//!
//! Every event the contract publishes now carries a [`NotificationCategory`] as
//! its trailing topic so off-chain consumers can subscribe to / filter by whole
//! categories. These tests verify:
//! - each action emits the expected category, and
//! - the change is backward compatible: the event name remains the first topic
//!   and the previously defined topics/data are unchanged.

use crate::base::events::NotificationCategory;
use crate::test_utils::{create_test_group, setup_test_env};
use crate::AutoShareContractClient;

use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{Address, BytesN, Symbol, TryFromVal, Val, Vec};

/// Returns the topic list of the most recently emitted event whose first topic
/// matches `event_name` (the snake_case event name produced by `#[contractevent]`).
fn topics_of(env: &soroban_sdk::Env, event_name: &str) -> Option<Vec<Val>> {
    let target = Symbol::new(env, event_name);
    let mut found: Option<Vec<Val>> = None;
    for (_addr, topics, _data) in env.events().all().iter() {
        if topics.is_empty() {
            continue;
        }
        let first = topics.get(0).unwrap();
        if let Ok(name) = Symbol::try_from_val(env, &first) {
            if name == target {
                // Keep iterating so we return the *latest* matching event.
                found = Some(topics);
            }
        }
    }
    found
}

/// Extracts the notification category (the trailing topic) for the latest event
/// named `event_name`.
fn category_of(env: &soroban_sdk::Env, event_name: &str) -> Option<NotificationCategory> {
    let topics = topics_of(env, event_name)?;
    let last = topics.last()?;
    NotificationCategory::try_from_val(env, &last).ok()
}

/// Returns the category of the most recently emitted event — i.e. the metadata a
/// streaming consumer would read off the event as it arrives.
fn latest_category(env: &soroban_sdk::Env) -> Option<NotificationCategory> {
    let (_addr, topics, _data) = env.events().all().last()?;
    let last = topics.last()?;
    NotificationCategory::try_from_val(env, &last).ok()
}

#[test]
fn test_created_event_has_group_category() {
    let test_env = setup_test_env();
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );

    assert_eq!(
        category_of(&test_env.env, "autoshare_created"),
        Some(NotificationCategory::Group)
    );
}

#[test]
fn test_updated_event_has_group_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    let id = create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );

    let mut members = Vec::new(&test_env.env);
    members.push_back(crate::base::types::GroupMember {
        address: Address::generate(&test_env.env),
        percentage: 100,
    });
    client.update_members(&id, &creator, &members);

    assert_eq!(
        category_of(&test_env.env, "autoshare_updated"),
        Some(NotificationCategory::Group)
    );
}

#[test]
fn test_deactivate_and_activate_events_have_group_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    let id = create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );

    client.deactivate_group(&id, &creator);
    assert_eq!(
        category_of(&test_env.env, "group_deactivated"),
        Some(NotificationCategory::Group)
    );

    client.activate_group(&id, &creator);
    assert_eq!(
        category_of(&test_env.env, "group_activated"),
        Some(NotificationCategory::Group)
    );
}

#[test]
fn test_pause_and_unpause_events_have_admin_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

    client.pause(&test_env.admin);
    assert_eq!(
        category_of(&test_env.env, "contract_paused"),
        Some(NotificationCategory::Admin)
    );

    client.unpause(&test_env.admin);
    assert_eq!(
        category_of(&test_env.env, "contract_unpaused"),
        Some(NotificationCategory::Admin)
    );
}

#[test]
fn test_admin_transfer_event_has_admin_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let new_admin = Address::generate(&test_env.env);

    client.transfer_admin(&test_env.admin, &new_admin);
    assert_eq!(
        category_of(&test_env.env, "admin_transferred"),
        Some(NotificationCategory::Admin)
    );
}

#[test]
fn test_withdrawal_event_has_financial_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    // Funds flow into the contract when a group is created with paid usages.
    create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );

    let recipient = Address::generate(&test_env.env);
    client.withdraw(&test_env.admin, &token, &1i128, &recipient);
    assert_eq!(
        category_of(&test_env.env, "withdrawal"),
        Some(NotificationCategory::Financial)
    );
}

/// Models an off-chain subscriber that only wants a subset of categories. As
/// each action is performed we read the category off the freshly emitted event
/// (the metadata a streaming consumer would key off) and decide whether to
/// process or skip it — proving events can be selectively filtered by type.
#[test]
fn test_events_can_be_filtered_by_category() {
    let test_env = setup_test_env();
    let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    // This consumer subscribes to Group and Financial notifications, but not Admin.
    let subscribed = |c: NotificationCategory| {
        matches!(
            c,
            NotificationCategory::Group | NotificationCategory::Financial
        )
    };

    let mut processed = 0u32;
    let mut skipped = 0u32;
    let mut route = || match latest_category(&test_env.env) {
        Some(c) if subscribed(c) => processed += 1,
        Some(_) => skipped += 1,
        None => {}
    };

    // Group event -> processed.
    create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );
    assert_eq!(
        latest_category(&test_env.env),
        Some(NotificationCategory::Group)
    );
    route();

    // Admin event -> skipped by this subscriber.
    client.pause(&test_env.admin);
    assert_eq!(
        latest_category(&test_env.env),
        Some(NotificationCategory::Admin)
    );
    route();
    client.unpause(&test_env.admin);

    // Financial event -> processed.
    let recipient = Address::generate(&test_env.env);
    client.withdraw(&test_env.admin, &token, &1i128, &recipient);
    assert_eq!(
        latest_category(&test_env.env),
        Some(NotificationCategory::Financial)
    );
    route();

    assert_eq!(processed, 2); // Group + Financial
    assert_eq!(skipped, 1); // Admin
}

/// Backward compatibility: the event name is still the first topic, the
/// pre-existing `creator` topic is unchanged, the category is appended as the
/// trailing topic, and the data payload (`id`) is preserved.
#[test]
fn test_created_event_backward_compatible_shape() {
    let test_env = setup_test_env();
    let creator = test_env.users.get(0).unwrap().clone();
    let token = test_env.mock_tokens.get(0).unwrap().clone();

    let id = create_test_group(
        &test_env.env,
        &test_env.autoshare_contract,
        &creator,
        &Vec::new(&test_env.env),
        1,
        &token,
    );

    let topics = topics_of(&test_env.env, "autoshare_created").expect("event emitted");
    // [0] event name, [1] creator (unchanged), [2] category (new trailing topic)
    assert_eq!(topics.len(), 3);

    let name = Symbol::try_from_val(&test_env.env, &topics.get(0).unwrap()).unwrap();
    assert_eq!(name, Symbol::new(&test_env.env, "autoshare_created"));

    let topic_creator = Address::try_from_val(&test_env.env, &topics.get(1).unwrap()).unwrap();
    assert_eq!(topic_creator, creator);

    let category =
        NotificationCategory::try_from_val(&test_env.env, &topics.get(2).unwrap()).unwrap();
    assert_eq!(category, NotificationCategory::Group);

    // Data payload is still the group id.
    let data = test_env
        .env
        .events()
        .all()
        .iter()
        .find_map(|(_addr, topics, data)| {
            let first = topics.get(0)?;
            let n = Symbol::try_from_val(&test_env.env, &first).ok()?;
            if n == Symbol::new(&test_env.env, "autoshare_created") {
                Some(data)
            } else {
                None
            }
        })
        .unwrap();
    let data_id = BytesN::<32>::try_from_val(&test_env.env, &data).unwrap();
    assert_eq!(data_id, id);
}
