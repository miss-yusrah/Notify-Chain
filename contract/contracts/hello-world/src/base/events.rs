use soroban_sdk::{contractevent, contracttype, Address, BytesN, String};

/// High-level notification category attached to every emitted event.
///
/// Off-chain consumers (listeners, indexers, dashboards) often only care about a
/// subset of the events the contract emits. Each event carries its category as a
/// trailing, indexed event topic so consumers can subscribe to  or filter out 
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
    /// Scheduled notification operations: cancellation.
    Notification = 3,
}

/// Severity level attached to every emitted event alongside its category.
///
/// Off-chain consumers (alerting, dashboards, paging) often route notifications
/// by priority rather than (or in addition to) category. Each event carries its
/// priority as a trailing, indexed event topic so consumers can subscribe to 
/// or page on  high-priority notifications without decoding the payload.
///
/// # Backward compatibility
///
/// The priority is published as the *last* topic of every event, after the
/// event name, the previously defined topics, and the category. Existing
/// listeners that only read the event name (the first topic), the prior topics,
/// or the category will continue to work unchanged: the extra trailing topic is
/// simply ignored by consumers that don't look for it.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NotificationPriority {
    /// Informational: routine lifecycle events. No action required.
    Low = 0,
    /// Standard: day-to-day operational events worth tracking.
    Medium = 1,
    /// Elevated: events the operator should review promptly.
    High = 2,
    /// Urgent: security-relevant or funds-moving events that demand
    /// immediate attention (e.g. admin transfer, authorization failure).
    Critical = 3,
}

/// Emitted when a new AutoShare group is created.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AutoshareCreated {
    #[topic]
    pub creator: Address,
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
    pub id: BytesN<32>,
}

/// Emitted when the contract is paused by the admin.
#[contractevent]
#[derive(Clone)]
pub struct ContractPaused {
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
}

/// Emitted when the contract is unpaused by the admin.
#[contractevent]
#[derive(Clone)]
pub struct ContractUnpaused {
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
}

/// Emitted when an AutoShare group's member list is updated.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct AutoshareUpdated {
    #[topic]
    pub updater: Address,
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
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
    #[topic]
    pub priority: NotificationPriority,
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
    #[topic]
    pub priority: NotificationPriority,
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
    #[topic]
    pub priority: NotificationPriority,
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
    #[topic]
    pub priority: NotificationPriority,
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
    #[topic]
    pub priority: NotificationPriority,
    pub action: String,
}

/// Emitted when a scheduled notification is cancelled.
///
/// The `notification_id` field carries the unique identifier of the notification
/// that was cancelled, allowing off-chain consumers to correlate the on-chain
/// event back to the corresponding scheduled notification record.
#[contractevent(data_format = "single-value")]
#[derive(Clone)]
pub struct ScheduledNotificationCancelled {
    #[topic]
    pub caller: Address,
    #[topic]
    pub category: NotificationCategory,
    #[topic]
    pub priority: NotificationPriority,
    pub notification_id: BytesN<32>,
}
