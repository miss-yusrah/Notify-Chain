/**
 * Notification preference types — mirrors the Soroban contract types (Issue #178)
 */

export type DeliveryChannel = "Wallet" | "Email" | "InApp";

export type NotificationCategory =
  | "Payment"
  | "GroupMembership"
  | "GroupStatus"
  | "SystemAlerts"
  | "General";

export interface ChannelPreference {
  channel: DeliveryChannel;
  enabled: boolean;
}

export interface CategoryPreference {
  category: NotificationCategory;
  enabled: boolean;
}

export interface RecipientPreferences {
  recipient: string; // Stellar public key
  channels: ChannelPreference[];
  categories: CategoryPreference[];
  updated_at: number; // Unix timestamp (ledger time)
}

/** Human-readable labels for the UI */
export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  Wallet: "Wallet Notifications",
  Email: "Email Notifications",
  InApp: "In-App Notifications",
};

export const CHANNEL_DESCRIPTIONS: Record<DeliveryChannel, string> = {
  Wallet: "On-chain events delivered directly to your connected wallet",
  Email: "Receive notifications at your verified email address",
  InApp: "Push notifications inside the Notify-Chain dashboard",
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  Payment: "Payment Events",
  GroupMembership: "Group Membership",
  GroupStatus: "Group Status",
  SystemAlerts: "System Alerts",
  General: "General",
};

export const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  Payment: "Payments received, sent, or subscription top-ups",
  GroupMembership: "Members added or removed from your groups",
  GroupStatus: "Groups activated or deactivated",
  SystemAlerts: "Contract paused, admin transfers, and critical alerts",
  General: "All other platform notifications",
};

/** Default all-enabled preferences (mirrors contract defaults) */
export const DEFAULT_PREFERENCES: Omit<RecipientPreferences, "recipient" | "updated_at"> = {
  channels: [
    { channel: "Wallet", enabled: true },
    { channel: "Email", enabled: true },
    { channel: "InApp", enabled: true },
  ],
  categories: [
    { category: "Payment", enabled: true },
    { category: "GroupMembership", enabled: true },
    { category: "GroupStatus", enabled: true },
    { category: "SystemAlerts", enabled: true },
    { category: "General", enabled: true },
  ],
};
