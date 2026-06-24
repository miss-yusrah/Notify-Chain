import { UserPreferences, PreferencesUpdateInput } from '../types/preferences';

export class PreferenceStore {
  private store = new Map<string, UserPreferences>();

  /** Returns preferences for userId, creating defaults if absent */
  get(userId: string): UserPreferences {
    if (!this.store.has(userId)) {
      const defaults: UserPreferences = {
        userId,
        categories: { discord: true },
        updatedAt: Date.now(),
      };
      this.store.set(userId, defaults);
    }
    const stored = this.store.get(userId)!;
    return { ...stored, categories: { ...stored.categories } };
  }

  /** Merges category updates, returns updated preferences */
  update(userId: string, input: PreferencesUpdateInput): UserPreferences {
    const existing = this.get(userId);
    const updated: UserPreferences = {
      ...existing,
      categories: { ...existing.categories, ...input.categories },
      updatedAt: Date.now(),
    };
    this.store.set(userId, updated);
    return { ...updated };
  }

  /** Returns true if the given category is enabled for userId */
  isCategoryEnabled(userId: string, category: string): boolean {
    const prefs = this.get(userId);
    // If the category has never been set, default to enabled
    return prefs.categories[category] !== false;
  }
}

export const preferenceStore = new PreferenceStore();
