import { Database } from '../database/database';
import { NotificationTemplateCache } from './notification-template-cache';
import {
  NotificationTemplateRepository,
  TemplateNotFoundError,
  TemplateValidationError,
} from './notification-template-repository';
import { TemplateAuditTrail } from './template-audit-trail';
import { CreateNotificationTemplateInput } from '../types/notification-template';

const baseInput = (): CreateNotificationTemplateInput => ({
  id: 'tmpl-001',
  name: 'Welcome Email',
  type: 'email',
  subject: 'Welcome',
  body: 'Hello {{name}}',
  variables: ['name'],
  metadata: { category: 'onboarding' },
});

async function createRepository(): Promise<{
  db: Database;
  repository: NotificationTemplateRepository;
  auditTrail: TemplateAuditTrail;
}> {
  const db = new Database(':memory:');
  await db.initialize();
  const auditTrail = new TemplateAuditTrail(db);
  const repository = new NotificationTemplateRepository(db, auditTrail);
  return { db, repository, auditTrail };
}

describe('NotificationTemplateRepository audit trail', () => {
  describe('create', () => {
    let db: Database;
    let repository: NotificationTemplateRepository;

    beforeEach(async () => {
      ({ db, repository } = await createRepository());
    });

    afterEach(async () => {
      await db.close();
    });

    it('creates a template without audit records', async () => {
      const template = await repository.create(baseInput());

      expect(template.id).toBe('tmpl-001');
      expect(template.name).toBe('Welcome Email');
      expect(await repository.getUpdateHistory('tmpl-001')).toEqual([]);
    });

    it('rejects empty template name', async () => {
      await expect(
        repository.create({ ...baseInput(), name: '   ' }),
      ).rejects.toThrow(TemplateValidationError);
    });

    it('rejects empty template body', async () => {
      await expect(
        repository.create({ ...baseInput(), body: '' }),
      ).rejects.toThrow(TemplateValidationError);
    });
  });

  describe('update', () => {
    let db: Database;
    let repository: NotificationTemplateRepository;

    beforeEach(async () => {
      ({ db, repository } = await createRepository());
      await repository.create(baseInput());
    });

    afterEach(async () => {
      await db.close();
    });

    it('records update history with actor and timestamp', async () => {
      const before = Date.now();
      const updated = await repository.update(
        'tmpl-001',
        { body: 'Hello {{name}}, welcome aboard!' },
        'admin@example.com',
      );
      const after = Date.now();

      expect(updated.body).toBe('Hello {{name}}, welcome aboard!');

      const history = await repository.getUpdateHistory('tmpl-001');
      expect(history).toHaveLength(1);
      expect(history[0].actor).toBe('admin@example.com');
      expect(history[0].action).toBe('UPDATE');
      expect(history[0].changedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(history[0].changedAt.getTime()).toBeLessThanOrEqual(after);
      expect(history[0].previousSnapshot.body).toBe('Hello {{name}}');
      expect(history[0].newSnapshot.body).toBe('Hello {{name}}, welcome aboard!');
    });

    it('stores multiple immutable audit records for successive updates', async () => {
      await repository.update('tmpl-001', { name: 'Welcome Email v2' }, 'editor-1');
      await repository.update('tmpl-001', { subject: 'Welcome aboard' }, 'editor-2');

      const history = await repository.getUpdateHistory('tmpl-001');
      expect(history).toHaveLength(2);
      expect(history[0].actor).toBe('editor-1');
      expect(history[1].actor).toBe('editor-2');
      expect(history[0].newSnapshot.name).toBe('Welcome Email v2');
      expect(history[1].newSnapshot.subject).toBe('Welcome aboard');
    });

    it('requires a non-empty actor', async () => {
      await expect(
        repository.update('tmpl-001', { body: 'Updated body' }, '   '),
      ).rejects.toThrow(TemplateValidationError);
    });

    it('throws when template does not exist', async () => {
      await expect(
        repository.update('missing-template', { body: 'Nope' }, 'admin@example.com'),
      ).rejects.toThrow(TemplateNotFoundError);
    });

    it('does not write audit history when update makes no changes', async () => {
      const unchanged = await repository.update(
        'tmpl-001',
        { body: 'Hello {{name}}' },
        'admin@example.com',
      );

      expect(unchanged.body).toBe('Hello {{name}}');
      expect(await repository.getUpdateHistory('tmpl-001')).toEqual([]);
    });

    it('invalidates cached templates after update', async () => {
      const cache = new NotificationTemplateCache(60, 0);
      const auditTrail = new TemplateAuditTrail(db);
      const cachedRepository = new NotificationTemplateRepository(db, auditTrail, cache);
      const template = await cachedRepository.getById('tmpl-001');
      cache.set('tmpl-001', template!);
      expect(cache.has('tmpl-001')).toBe(true);

      await cachedRepository.update('tmpl-001', { body: 'Cached invalidation test' }, 'cache-admin');

      expect(cache.has('tmpl-001')).toBe(false);
    });
  });

  describe('audit immutability', () => {
    let db: Database;
    let repository: NotificationTemplateRepository;

    beforeEach(async () => {
      ({ db, repository } = await createRepository());
      await repository.create(baseInput());
      await repository.update('tmpl-001', { body: 'Updated once' }, 'auditor');
    });

    afterEach(async () => {
      await db.close();
    });

    it('rejects updates to audit records', async () => {
      const [record] = await repository.getUpdateHistory('tmpl-001');

      await expect(
        db.run('UPDATE notification_template_audit_log SET actor = ? WHERE id = ?', [
          'tampered',
          record.id,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it('rejects deletes of audit records', async () => {
      const [record] = await repository.getUpdateHistory('tmpl-001');

      await expect(
        db.run('DELETE FROM notification_template_audit_log WHERE id = ?', [record.id]),
      ).rejects.toThrow(/immutable/i);
    });
  });
});

describe('TemplateAuditTrail', () => {
  let db: Database;
  let auditTrail: TemplateAuditTrail;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.initialize();
    auditTrail = new TemplateAuditTrail(db);
    await db.run(
      `
        INSERT INTO notification_templates (
          id, name, type, body, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      ['tmpl-audit', 'Audit Template', 'email', 'Body'],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('rejects audit records without actor', async () => {
    await expect(
      auditTrail.record({
        templateId: 'tmpl-audit',
        actor: ' ',
        previousSnapshot: {
          id: 'tmpl-audit',
          name: 'Audit Template',
          type: 'email',
          body: 'Body',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        newSnapshot: {
          id: 'tmpl-audit',
          name: 'Audit Template',
          type: 'email',
          body: 'Updated body',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow('Actor is required');
  });

  it('returns empty history for templates with no updates', async () => {
    await expect(auditTrail.getByTemplateId('tmpl-audit')).resolves.toEqual([]);
  });
});
