#![no_std]
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};

// 1. Declare the foundational modules (Requirement: Modular Structure)
pub mod base {
    pub mod errors;
    pub mod events;
    pub mod types;
}

pub mod interfaces {
    pub mod autoshare;
}

// 2. Declare the main logic file where the functions are implemented
mod autoshare_logic;

#[cfg(test)]
pub mod mock_token;

#[contract]
pub struct AutoShareContract;

const VERSION: u32 = 1;

#[contractimpl]
impl AutoShareContract {
    /// Returns the current version of the contract.
    pub fn version(_env: Env) -> u32 {
        VERSION
    }

    // ============================================================================
    // Admin Management
    // ============================================================================

    /// Initializes the contract admin. Can only be called once.
    pub fn initialize_admin(env: Env, admin: Address) {
        autoshare_logic::initialize_admin(env, admin);
    }

    /// Pauses the contract. Only admin can call.
    pub fn pause(env: Env, admin: Address) {
        autoshare_logic::pause(env, admin).unwrap();
    }

    /// Unpauses the contract. Only admin can call.
    pub fn unpause(env: Env, admin: Address) {
        autoshare_logic::unpause(env, admin).unwrap();
    }

    /// Returns the current pause status.
    pub fn get_paused_status(env: Env) -> bool {
        autoshare_logic::get_paused_status(&env)
    }

    // ============================================================================
    // AutoShare Group Management
    // ============================================================================

    /// Creates a new AutoShare plan with payment.
    /// Requirement: create_autoshare should store data, accept payment, and emit an event.
    pub fn create(
        env: Env,
        id: BytesN<32>,
        name: String,
        creator: Address,
        usage_count: u32,
        payment_token: Address,
    ) {
        autoshare_logic::create_autoshare(env, id, name, creator, usage_count, payment_token)
            .unwrap();
    }

    /// Update members of an existing AutoShare plan.
    /// Requirement: Only creator can update. Validates percentages.
    pub fn update_members(
        env: Env,
        id: BytesN<32>,
        caller: Address,
        new_members: Vec<base::types::GroupMember>,
    ) {
        autoshare_logic::update_members(env, id, caller, new_members).unwrap();
    }

    /// Retrieves an existing AutoShare plan.
    /// Requirement: get_autoshare should return the plan details.
    pub fn get(env: Env, id: BytesN<32>) -> base::types::AutoShareDetails {
        autoshare_logic::get_autoshare(env, id).unwrap()
    }

    /// Retrieves all AutoShare groups.
    pub fn get_all_groups(env: Env) -> Vec<base::types::AutoShareDetails> {
        autoshare_logic::get_all_groups(env)
    }

    /// Retrieves all AutoShare groups created by a specific address.
    pub fn get_groups_by_creator(env: Env, creator: Address) -> Vec<base::types::AutoShareDetails> {
        autoshare_logic::get_groups_by_creator(env, creator)
    }

    /// Checks if an address is a member of a specific group.
    pub fn is_group_member(env: Env, id: BytesN<32>, address: Address) -> bool {
        autoshare_logic::is_group_member(env, id, address).unwrap()
    }

    pub fn get_group_members(env: Env, id: BytesN<32>) -> Vec<base::types::GroupMember> {
        autoshare_logic::get_group_members(env, id).unwrap()
    }

    /// Adds a member to a group with specified percentage.
    pub fn add_group_member(
        env: Env,
        id: BytesN<32>,
        caller: Address,
        address: Address,
        percentage: u32,
    ) {
        autoshare_logic::add_group_member(env, id, caller, address, percentage).unwrap();
    }

    /// Deactivates a group. Only the creator can deactivate.
    pub fn deactivate_group(env: Env, id: BytesN<32>, caller: Address) {
        autoshare_logic::deactivate_group(env, id, caller).unwrap();
    }

    /// Activates a group. Only the creator can activate.
    pub fn activate_group(env: Env, id: BytesN<32>, caller: Address) {
        autoshare_logic::activate_group(env, id, caller).unwrap();
    }

    /// Returns whether a group is active.
    pub fn is_group_active(env: Env, id: BytesN<32>) -> bool {
        autoshare_logic::is_group_active(env, id).unwrap()
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        autoshare_logic::get_admin(env).unwrap()
    }

    /// Transfers admin rights to a new address. Only current admin can call.
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        autoshare_logic::transfer_admin(env, current_admin, new_admin).unwrap();
    }

    /// Withdraws tokens from the contract. Only admin can call.
    pub fn withdraw(env: Env, admin: Address, token: Address, amount: i128, recipient: Address) {
        autoshare_logic::withdraw(env, admin, token, amount, recipient).unwrap();
    }

    /// Returns the contract's balance for a specified token.
    pub fn get_contract_balance(env: Env, token: Address) -> i128 {
        autoshare_logic::get_contract_balance(env, token)
    }

    // ============================================================================
    // Token Management
    // ============================================================================

    /// Adds a supported payment token (admin only).
    pub fn add_supported_token(env: Env, token: Address, admin: Address) {
        autoshare_logic::add_supported_token(env, token, admin).unwrap();
    }

    /// Removes a supported payment token (admin only).
    pub fn remove_supported_token(env: Env, token: Address, admin: Address) {
        autoshare_logic::remove_supported_token(env, token, admin).unwrap();
    }

    /// Returns all supported payment tokens.
    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        autoshare_logic::get_supported_tokens(env)
    }

    /// Checks if a token is supported.
    pub fn is_token_supported(env: Env, token: Address) -> bool {
        autoshare_logic::is_token_supported(env, token)
    }

    // ============================================================================
    // Payment Configuration
    // ============================================================================

    /// Sets the usage fee (admin only).
    pub fn set_usage_fee(env: Env, fee: u32, admin: Address) {
        autoshare_logic::set_usage_fee(env, fee, admin).unwrap();
    }

    /// Returns the current usage fee.
    pub fn get_usage_fee(env: Env) -> u32 {
        autoshare_logic::get_usage_fee(env)
    }

    // ============================================================================
    // Subscription Management
    // ============================================================================

    /// Tops up a group's subscription with additional usages.
    pub fn topup_subscription(
        env: Env,
        id: BytesN<32>,
        additional_usages: u32,
        payment_token: Address,
        payer: Address,
    ) {
        autoshare_logic::topup_subscription(env, id, additional_usages, payment_token, payer)
            .unwrap();
    }

    // ============================================================================
    // Payment History
    // ============================================================================

    /// Returns all payment history for a user.
    pub fn get_user_payment_history(env: Env, user: Address) -> Vec<base::types::PaymentHistory> {
        autoshare_logic::get_user_payment_history(env, user)
    }

    /// Returns all payment history for a group.
    pub fn get_group_payment_history(env: Env, id: BytesN<32>) -> Vec<base::types::PaymentHistory> {
        autoshare_logic::get_group_payment_history(env, id)
    }

    // ============================================================================
    // Usage Tracking
    // ============================================================================

    /// Returns the remaining usages for a group.
    pub fn get_remaining_usages(env: Env, id: BytesN<32>) -> u32 {
        autoshare_logic::get_remaining_usages(env, id).unwrap()
    }

    /// Returns the total usages paid for a group.
    pub fn get_total_usages_paid(env: Env, id: BytesN<32>) -> u32 {
        autoshare_logic::get_total_usages_paid(env, id).unwrap()
    }

    /// Reduces the usage count by 1 (dummy function for testing).
    pub fn reduce_usage(env: Env, id: BytesN<32>) {
        autoshare_logic::reduce_usage(env, id).unwrap();
    }

    // ============================================================================
    // Scheduled Notification Management
    // ============================================================================

    /// Cancels a scheduled notification and emits a ScheduledNotificationCancelled event.
    ///
    /// The `notification_id` uniquely identifies the notification being cancelled.
    /// Callers must authenticate. The contract is paused-aware: cancellations are
    /// rejected while the contract is paused.
    pub fn cancel_notification(env: Env, notification_id: BytesN<32>, caller: Address) {
        autoshare_logic::cancel_notification(env, notification_id, caller).unwrap();
    }

    // ============================================================================
    // Notification Expiration
    // ============================================================================

    /// Schedules a notification on-chain that expires after `ttl_seconds`.
    ///
    /// The notification becomes invalid once the ledger timestamp reaches
    /// `created_at + ttl_seconds`. Emits a `NotificationScheduled` event.
    pub fn schedule_notification(
        env: Env,
        notification_id: BytesN<32>,
        creator: Address,
        ttl_seconds: u64,
    ) {
        autoshare_logic::schedule_notification(env, notification_id, creator, ttl_seconds).unwrap();
    }

    /// Returns the stored details for a scheduled notification.
    pub fn get_notification(
        env: Env,
        notification_id: BytesN<32>,
    ) -> base::types::ScheduledNotification {
        autoshare_logic::get_notification(env, notification_id).unwrap()
    }

    /// Returns whether a scheduled notification has expired.
    pub fn is_notification_expired(env: Env, notification_id: BytesN<32>) -> bool {
        autoshare_logic::is_notification_expired(env, notification_id).unwrap()
    }

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

#[cfg(test)]
#[path = "tests/test_utils.rs"]
pub mod test_utils;

#[cfg(test)]
mod tests {
    #[path = "../tests/autoshare_test.rs"]
    mod autoshare_test;

    #[path = "../tests/pause_test.rs"]
    mod pause_test;

    #[path = "../tests/mock_token_test.rs"]
    mod mock_token_test;

    #[path = "../tests/version_test.rs"]
    mod version_test;

    #[path = "../tests/test_utils_test.rs"]
    mod test_utils_test;

    #[path = "../tests/notification_test.rs"]
    mod notification_test;

    #[path = "../tests/expiration_test.rs"]
    mod expiration_test;

    #[path = "../tests/revocation_test.rs"]
    mod revocation_test;
}
