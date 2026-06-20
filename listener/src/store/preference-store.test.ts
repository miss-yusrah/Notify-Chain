import { PreferenceStore } from './preference-store';

describe('PreferenceStore', () => {
  let store: PreferenceStore;

  beforeEach(() => {
    store = new PreferenceStore();
  });

  describe('get', () => {
    it('returns default preferences for a new user', () => {
      const prefs = store.get('user-1');
      expect(prefs.userId).toBe('user-1');
      expect(prefs.categories.discord).toBe(true);
      expect(typeof prefs.updatedAt).toBe('number');
    });

    it('returns a copy so mutations do not affect stored state', () => {
      const prefs = store.get('user-1');
      prefs.categories.discord = false;
      expect(store.get('user-1').categories.discord).toBe(true);
    });
  });

  describe('update', () => {
    it('disables a notification category', () => {
      store.update('user-1', { categories: { discord: false } });
      expect(store.get('user-1').categories.discord).toBe(false);
    });

    it('re-enables a disabled category', () => {
      store.update('user-1', { categories: { discord: false } });
      store.update('user-1', { categories: { discord: true } });
      expect(store.get('user-1').categories.discord).toBe(true);
    });

    it('merges categories without removing unrelated ones', () => {
      store.update('user-1', { categories: { discord: true, email: true } });
      store.update('user-1', { categories: { discord: false } });
      expect(store.get('user-1').categories.email).toBe(true);
      expect(store.get('user-1').categories.discord).toBe(false);
    });

    it('updates updatedAt timestamp', async () => {
      const before = store.get('user-1').updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      store.update('user-1', { categories: { discord: false } });
      expect(store.get('user-1').updatedAt).toBeGreaterThan(before);
    });

    it('persists changes across get calls', () => {
      store.update('user-2', { categories: { discord: false } });
      expect(store.get('user-2').categories.discord).toBe(false);
      expect(store.get('user-2').categories.discord).toBe(false);
    });
  });

  describe('isCategoryEnabled', () => {
    it('returns true for the default discord category', () => {
      expect(store.isCategoryEnabled('user-1', 'discord')).toBe(true);
    });

    it('returns false after disabling the discord category', () => {
      store.update('user-1', { categories: { discord: false } });
      expect(store.isCategoryEnabled('user-1', 'discord')).toBe(false);
    });

    it('returns true for an unknown category (default enabled)', () => {
      expect(store.isCategoryEnabled('user-1', 'unknown-channel')).toBe(true);
    });

    it('isolates preferences between users', () => {
      store.update('user-a', { categories: { discord: false } });
      expect(store.isCategoryEnabled('user-b', 'discord')).toBe(true);
    });
  });
});
