import { NotificationTemplateCache, getTemplateCache, resetTemplateCache, NotificationTemplate } from './notification-template-cache';

const makeTemplate = (id: string): NotificationTemplate => ({
  id,
  name: `Template ${id}`,
  type: 'email',
  subject: `Subject ${id}`,
  body: `Hello {{name}}, this is template ${id}`,
  variables: ['name'],
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('NotificationTemplateCache', () => {
  let cache: NotificationTemplateCache;

  beforeEach(() => {
    cache = new NotificationTemplateCache(60, 0);
  });

  afterEach(() => {
    cache.invalidateAll();
    resetTemplateCache();
  });

  describe('get and set', () => {
    it('returns undefined for uncached template', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('caches and retrieves a template', () => {
      const template = makeTemplate('tmpl-1');
      cache.set('tmpl-1', template);
      expect(cache.get('tmpl-1')).toEqual(template);
    });

    it('has() returns false for uncached template', () => {
      expect(cache.has('missing')).toBe(false);
    });

    it('has() returns true for cached template', () => {
      cache.set('tmpl-2', makeTemplate('tmpl-2'));
      expect(cache.has('tmpl-2')).toBe(true);
    });
  });

  describe('getOrLoad', () => {
    it('calls loader on cache miss', async () => {
      const loader = jest.fn().mockResolvedValue(makeTemplate('tmpl-3'));
      const result = await cache.getOrLoad('tmpl-3', loader);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('does not call loader on cache hit', async () => {
      const template = makeTemplate('tmpl-4');
      cache.set('tmpl-4', template);
      const loader = jest.fn().mockResolvedValue(template);
      await cache.getOrLoad('tmpl-4', loader);
      expect(loader).not.toHaveBeenCalled();
    });

    it('caches result after loading', async () => {
      const loader = jest.fn().mockResolvedValue(makeTemplate('tmpl-5'));
      await cache.getOrLoad('tmpl-5', loader);
      expect(cache.has('tmpl-5')).toBe(true);
    });

    it('returns undefined when loader returns undefined', async () => {
      const loader = jest.fn().mockResolvedValue(undefined);
      const result = await cache.getOrLoad('missing', loader);
      expect(result).toBeUndefined();
      expect(cache.has('missing')).toBe(false);
    });
  });

  describe('invalidation', () => {
    it('invalidates a single template', () => {
      cache.set('tmpl-6', makeTemplate('tmpl-6'));
      cache.invalidate('tmpl-6');
      expect(cache.has('tmpl-6')).toBe(false);
    });

    it('invalidates all templates', () => {
      cache.set('tmpl-7', makeTemplate('tmpl-7'));
      cache.set('tmpl-8', makeTemplate('tmpl-8'));
      cache.invalidateAll();
      expect(cache.has('tmpl-7')).toBe(false);
      expect(cache.has('tmpl-8')).toBe(false);
    });
  });

  describe('cache statistics', () => {
    it('tracks hits and misses', () => {
      cache.set('tmpl-9', makeTemplate('tmpl-9'));
      cache.get('tmpl-9'); // hit
      cache.get('missing'); // miss
      cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
    });

    it('calculates hit rate correctly', () => {
      cache.set('tmpl-10', makeTemplate('tmpl-10'));
      cache.get('tmpl-10'); // hit
      cache.get('tmpl-10'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('returns 0 hit rate when no requests made', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('resets stats correctly', () => {
      cache.get('missing');
      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('singleton', () => {
    it('getTemplateCache returns same instance', () => {
      const a = getTemplateCache();
      const b = getTemplateCache();
      expect(a).toBe(b);
    });

    it('resetTemplateCache creates new instance', () => {
      const a = getTemplateCache();
      resetTemplateCache();
      const b = getTemplateCache();
      expect(a).not.toBe(b);
    });
  });
});

