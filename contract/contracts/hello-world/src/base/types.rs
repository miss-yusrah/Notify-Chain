use crate::base::events::NotificationPriority;
use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AutoShareDetails {
    pub id: BytesN<32>,
    pub name: String,
    pub creator: Address,
    pub priority: NotificationPriority,
    pub usage_count: u32,
    pub total_usages_paid: u32,
    pub members: Vec<GroupMember>,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GroupMember {
    pub address: Address,
    pub percentage: u32,
}

/// A notification stored on-chain with a bounded lifetime.
///
/// The notification is considered **expired** — and therefore invalid for any
/// further interaction — once the ledger timestamp reaches `expires_at`.
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentHistory {
    pub user: Address,
    pub group_id: BytesN<32>,
    pub usages_purchased: u32,
    pub amount_paid: i128,
    pub timestamp: u64,
}
