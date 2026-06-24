export type NotificationCategory = 'discord' | string;

export interface UserPreferences {
  userId: string;
  /** Map of notification category → enabled flag */
  categories: Record<NotificationCategory, boolean>;
  updatedAt: number;
}

export interface PreferencesUpdateInput {
  categories: Record<NotificationCategory, boolean>;
}
