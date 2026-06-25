import { Database, getDatabase } from '../database/database';
import { SearchSuggestionService } from './search-suggestion';

describe('SearchSuggestionService', () => {
  let db: Database;
  let service: SearchSuggestionService;

  beforeAll(async () => {
    // Initialize in-memory SQLite database
    db = getDatabase(':memory:');
    await db.initialize();
    service = new SearchSuggestionService();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Clear data from tables
    await db.run('DELETE FROM processed_events');
    await db.run('DELETE FROM scheduled_notifications');
    await db.run('DELETE FROM notification_templates');
    service.clearCache();
  });

  it('returns empty suggestions when the database is empty', async () => {
    const results = await service.getSuggestions('test');
    expect(results).toEqual({
      query: 'test',
      recipients: [],
      contracts: [],
      types: [],
      eventTypes: [],
      transactions: [],
      templates: [],
      all: [],
    });
  });

  it('returns matches across different categories for partial search query', async () => {
    // Insert mock data
    // 1. scheduled_notifications (recipients, contract_address, type)
    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, contract_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'discord', 'alice-discord', '2026-06-24T12:00:00Z', 'GD345abc', '2026-06-24T12:00:00Z']
    );
    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, contract_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'webhook', 'bob-webhook', '2026-06-24T12:05:00Z', 'GD678def', '2026-06-24T12:05:00Z']
    );

    // 2. processed_events (event_type, tx_hash)
    await db.run(
      `INSERT INTO processed_events 
       (event_id, contract_address, fingerprint, ledger_number, tx_hash, event_type, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['evt-1', 'GD345abc', 'GD345abc:evt-1', 1, 'tx-123456', 'transfer_event', '2026-06-24T12:00:00Z']
    );
    await db.run(
      `INSERT INTO processed_events 
       (event_id, contract_address, fingerprint, ledger_number, tx_hash, event_type, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['evt-2', 'GD678def', 'GD678def:evt-2', 1, 'tx-987654', 'mint_event', '2026-06-24T12:05:00Z']
    );

    // 3. notification_templates (name/id)
    await db.run(
      `INSERT INTO notification_templates 
       (id, name, type, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['tmpl-welcome-123', 'Welcome Template', 'discord', 'Hello', '2026-06-24T12:00:00Z']
    );
    await db.run(
      `INSERT INTO notification_templates 
       (id, name, type, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['tmpl-alert-456', 'System Alert', 'email', 'Warning', '2026-06-24T12:05:00Z']
    );

    // Run query that should match 'alice', 'GD345', 'discord', 'transfer', 'tx-123', 'Welcome' (via 123 in ID)
    const results = await service.getSuggestions('123');

    // 'alice-discord' doesn't contain '123'
    expect(results.recipients).toEqual([]);
    // 'GD345abc' doesn't contain '123'
    expect(results.contracts).toEqual([]);
    // 'discord' type doesn't contain '123'
    expect(results.types).toEqual([]);
    // 'transfer_event' doesn't contain '123'
    expect(results.eventTypes).toEqual([]);
    
    // 'tx-123456' contains '123'
    expect(results.transactions).toEqual(['tx-123456']);
    // 'tmpl-welcome-123' template id contains '123'
    expect(results.templates).toEqual(['Welcome Template']);

    // 'all' flat list should combine them
    expect(results.all).toContain('tx-123456');
    expect(results.all).toContain('Welcome Template');
  });

  it('performs case-insensitive partial matches', async () => {
    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'discord', 'Charlie-Discord', '2026-06-24T12:00:00Z', '2026-06-24T12:00:00Z']
    );

    const results = await service.getSuggestions('charlie');
    expect(results.recipients).toEqual(['Charlie-Discord']);
  });

  it('orders suggestions by recent activity (newest first)', async () => {
    // Insert with different created_at dates
    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'discord', 'recipient-old', '2026-06-24T12:00:00Z', '2026-06-24T12:00:00Z']
    );

    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'discord', 'recipient-new', '2026-06-24T12:10:00Z', '2026-06-24T12:10:00Z']
    );

    const results = await service.getSuggestions('recipient');
    expect(results.recipients).toEqual(['recipient-new', 'recipient-old']);
  });

  it('respects the query limit constraint', async () => {
    // Insert 10 different recipients
    for (let i = 1; i <= 10; i++) {
      await db.run(
        `INSERT INTO scheduled_notifications 
         (payload, notification_type, target_recipient, execute_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [JSON.stringify({}), 'discord', `recipient-${i}`, '2026-06-24T12:00:00Z', `2026-06-24T12:0${i}:00Z`]
      );
    }

    const results = await service.getSuggestions('recipient', 3);
    expect(results.recipients.length).toBe(3);
    // Flat 'all' array should be capped to 2 * limit = 6
    expect(results.all.length).toBeLessThanOrEqual(6);
  });

  it('uses the cache for subsequent identical requests within TTL', async () => {
    await db.run(
      `INSERT INTO scheduled_notifications 
       (payload, notification_type, target_recipient, execute_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify({}), 'discord', 'cached-user', '2026-06-24T12:00:00Z', '2026-06-24T12:00:00Z']
    );

    const firstResults = await service.getSuggestions('cached');
    expect(firstResults.recipients).toEqual(['cached-user']);

    // Delete recipient from DB to verify it's served from cache
    await db.run('DELETE FROM scheduled_notifications');

    const secondResults = await service.getSuggestions('cached');
    expect(secondResults.recipients).toEqual(['cached-user']); // Served from cache

    // Clear cache and try again
    service.clearCache();
    const thirdResults = await service.getSuggestions('cached');
    expect(thirdResults.recipients).toEqual([]); // Cache cleared, queries DB and returns empty
  });
});
