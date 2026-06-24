import { Database } from '../database/database';
import { NotificationTemplateCache } from './notification-template-cache';
import { NotificationTemplateRepository } from './notification-template-repository';
import { NotificationTemplateService } from './notification-template-service';
import { TemplateAuditTrail } from './template-audit-trail';

describe('NotificationTemplateService', () => {
  let db: Database;
  let service: NotificationTemplateService;
  let cache: NotificationTemplateCache;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.initialize();
    cache = new NotificationTemplateCache(60, 0);
    const repository = new NotificationTemplateRepository(db, new TemplateAuditTrail(db), cache);
    service = new NotificationTemplateService(repository, cache);
  });

  afterEach(async () => {
    await db.close();
  });

  it('routes updates through the repository and invalidates cache', async () => {
    await service.create({
      id: 'svc-template',
      name: 'Service Template',
      type: 'email',
      body: 'Original body',
    });

    const cached = await service.getById('svc-template');
    expect(cached?.body).toBe('Original body');
    expect(cache.has('svc-template')).toBe(true);

    await service.update('svc-template', { body: 'Updated body' }, 'service-admin');

    expect(cache.has('svc-template')).toBe(false);
    const refreshed = await service.getById('svc-template');
    expect(refreshed?.body).toBe('Updated body');

    const history = await service.getAuditHistory('svc-template');
    expect(history).toHaveLength(1);
    expect(history[0].actor).toBe('service-admin');
  });
});
