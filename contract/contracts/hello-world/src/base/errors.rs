use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)] // This is required for most Soroban errors
pub enum Error {
    /// Triggered when the input provided by the user is invalid.
    InvalidInput = 1,
    /// Triggered when an entity (like a group) already exists.
    AlreadyExists = 2,
    /// Triggered when an entity is not found in storage.
    NotFound = 3,
    /// Triggered when the token used for payment is not supported.
    UnsupportedToken = 4,
    /// Triggered when the user hasn't provided enough payment.
    InsufficientPayment = 5,
    /// Triggered when an AutoShare group has no remaining usages.
    NoUsagesRemaining = 6,
    /// Triggered when the usage count provided is invalid (e.g., zero).
    InvalidUsageCount = 7,
    /// Triggered when the caller lacks authorization to perform an action.
    Unauthorized = 8,
    /// Triggered when the user has insufficient balance to complete a transaction.
    InsufficientBalance = 9,
    /// Triggered when an invalid amount is specified for a transaction.
    InvalidAmount = 10,
    /// Triggered when an action is attempted while the contract is paused.
    ContractPaused = 11,
    /// Triggered when attempting to pause an already paused contract.
    AlreadyPaused = 12,
    /// Triggered when attempting to unpause a contract that isn't paused.
    NotPaused = 13,
    /// Triggered when the caller is not the admin.
    NotAuthorized = 14,
    /// Triggered when group member percentages don't sum to exactly 100.
    InvalidTotalPercentage = 15,
    /// Triggered when trying to update members with an empty list.
    EmptyMembers = 16,
    /// Triggered when the member list contains duplicate addresses.
    DuplicateMember = 17,
    /// Triggered when interacting with a deactivated group.
    GroupInactive = 18,
    /// Triggered when attempting to activate an already active group.
    GroupAlreadyActive = 19,
    /// Triggered when attempting to deactivate an already inactive group.
    GroupAlreadyInactive = 20,
    /// Triggered when the contract has insufficient balance for a withdrawal.
    InsufficientContractBalance = 21,
    /// Triggered when a name string exceeds the maximum allowed length.
    NameTooLong = 22,
    /// Triggered when the number of members exceeds the maximum allowed.
    TooManyMembers = 23,
}
