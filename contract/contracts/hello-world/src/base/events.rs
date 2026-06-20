use soroban_sdk::{contractevent, contracttype, Address, BytesN, String};

/// High-level notification category attached to every emitted event.
///
/// Off-chain consumers (listeners, indexers, dashboards) often only care about a
/// subset of the events the contract emits. Each event carries its category as a
/// trailing, indexed event topic so consumers can subscribe to — or filter out —
/// whole categories without having to decode the event payload first.
///
/// # Backward compatibility
///
/// The category is published as the *last* topic of every event, after the event
/// name and any pre-existing topics. Existing listeners that read the event name
/// (the first topic) and the previously defined topics/data are unaffected: the
/// extra trailing topic is simply ignored by consumers that don't look for it.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NotificationCategory {
    /// Lifecycle changes to AutoShare groups: created, updated, activated,
    /// deactivated.
    Group = 0,
    /// Administrative / system actions: pause, unpause, admin transfer.
    Admin = 1,
    /// Movement of funds: withdrawals.
    Financial = 2,
}

/// Emitted when a new AutoShare group is created.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AutoshareCreated {
    #[topic]
    pub creator: Address,
    #[topic]
    pub category: NotificationCategory,
    pub id: BytesN<32>,
}

/// Emitted when the contract is paused by the admin.
#[contractevent]
#[derive(Clone)]
pub struct ContractPaused {
    #[topic]
    pub category: NotificationCategory,
}

/// Emitted when the contract is unpaused by the admin.
#[contractevent]
#[derive(Clone)]
pub struct ContractUnpaused {
    #[topic]
    pub category: NotificationCategory,
}

/// Emitted when an AutoShare group's member list is updated.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AutoshareUpdated {
    #[topic]
    pub updater: Address,
    #[topic]
    pub category: NotificationCategory,
    pub id: BytesN<32>,
}

/// Emitted when an AutoShare group is deactivated by its creator.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct GroupDeactivated {
    #[topic]
    pub creator: Address,
    #[topic]
    pub category: NotificationCategory,
    pub id: BytesN<32>,
}

/// Emitted when a deactivated AutoShare group is reactivated by its creator.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct GroupActivated {
    #[topic]
    pub creator: Address,
    #[topic]
    pub category: NotificationCategory,
    pub id: BytesN<32>,
}

/// Emitted when the admin rights of the contract are transferred.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AdminTransferred {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub category: NotificationCategory,
    pub new_admin: Address,
}

/// Emitted when the admin withdraws collected usage fees from the contract.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct Withdrawal {
    #[topic]
    pub token: Address,
    #[topic]
    pub recipient: Address,
    #[topic]
    pub category: NotificationCategory,
    pub amount: i128,
}

/// Emitted when an authorization failure is detected by the contract.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AuthorizationFailure {
    #[topic]
    pub caller: Address,
    #[topic]
    pub category: NotificationCategory,
    pub action: String,
}
