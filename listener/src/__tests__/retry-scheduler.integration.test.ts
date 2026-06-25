/**
 * Integration test: RetryScheduler + ScheduledNotificationRepository + SQLite
 *
 * Uses an in-memory SQLite database so no file system state is needed.
 */
import { Database } from '../database/database';
import { ScheduledNotificationRepository } from '../services/scheduled-notification-repository';
import { RetryScheduler, RETRY_SCHEDULER_DEFAULTS, calculateBackoffDelay } from '../services/retry-scheduler';
import { NotificationStatus, NotificationType } from '../types/scheduled-notification';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../utils/request-id', () => ({ generateRequestId: () => 'integ-req-id' }));

// ─── helpers ────────────────────────────────────────────────────────────────

async function setupDb(): Promise<Database> {
  const db = new Database(':memory:');
  await db.initialize();
  // Add next_retry_at column (schema.sql ALTER TABLE is idempotent in our migration)
  // The column is already part of schema.sql after our patch, so this is a no-op guard.
  return db;
}

async function insertFailedNotification(
  repo: ScheduledNotificationRepository,
  db: Database,
  retryCount = 1,
  nextRetryAt: Date | null = null
): Promise<number> {
  // Create initially, then manually set retry_count and status to simulate a prior failure
  const id = await repo.create(
    {
      payload: { event: {}, contractConfig: {} },
      notificationType: NotificationType.DISCORD,
      targetRecipient: 'test-recipient',
      executeAt: new Date(Date.now() - 1000),
      maxRetries: 3,
    }
  );

  await db.run(
    `UPDATE scheduled_notifications
     SET status = ?, retry_count = ?, next_retry_at = ?
     WHERE id = ?`,
    [NotificationStatus.PENDING, retryCount, nextRetryAt?.toISOString() ?? null, id]
  );

  return id;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('RetryScheduler integration', () => {
  let db: Database;
  let repo: ScheduledNotificationRepository;

  beforeEach(async () => {
    db = await setupDb();
    repo = new ScheduledNotificationRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('picks up a PENDING notification with retry_count > 0 and marks it COMPLETED on success', async () => {
    const id = await insertFailedNotification(repo, db, 1, null);

    const discordService = { sendEventNotification: jest.fn().mockResolvedValue(true) } as any;
    const scheduler = new RetryScheduler(
      repo,
      { ...RETRY_SCHEDULER_DEFAULTS, jitter: false },
      discordService
    );

    await scheduler.runOnce();

    const row = await db.get<{ status: string; retry_count: number }>(
      'SELECT status, retry_count FROM scheduled_notifications WHERE id = ?',
      [id]
    );

    expect(row!.status).toBe(NotificationStatus.COMPLETED);
    expect(discordService.sendEventNotification).toHaveBeenCalledTimes(1);
  });

  it('writes next_retry_at when delivery fails and retries remain', async () => {
    const id = await insertFailedNotification(repo, db, 1, null);

    const discordService = { sendEventNotification: jest.fn().mockResolvedValue(false) } as any;
    const beforeRun = Date.now();
    const scheduler = new RetryScheduler(
      repo,
      { ...RETRY_SCHEDULER_DEFAULTS, baseDelayMs: 1000, multiplier: 2, jitter: false },
      discordService
    );

    await scheduler.runOnce();

    const row = await db.get<{ status: string; retry_count: number; next_retry_at: string | null }>(
      'SELECT status, retry_count, next_retry_at FROM scheduled_notifications WHERE id = ?',
      [id]
    );

    expect(row!.status).toBe(NotificationStatus.PENDING);
    expect(row!.retry_count).toBe(2); // incremented from 1 → 2
    expect(row!.next_retry_at).not.toBeNull();

    const nextRetryAt = new Date(row!.next_retry_at!).getTime();
    // Base backoff for attempt=1 without jitter: 1000 * 2^1 = 2000 ms
    const expectedDelay = calculateBackoffDelay(1, 1000, 2, RETRY_SCHEDULER_DEFAULTS.maxDelayMs, false);
    expect(nextRetryAt).toBeGreaterThanOrEqual(beforeRun + expectedDelay * 0.9);
  });

  it('marks notification FAILED when max retries exhausted', async () => {
    const id = await insertFailedNotification(repo, db, 3, null); // retryCount === maxRetries

    const discordService = { sendEventNotification: jest.fn().mockResolvedValue(false) } as any;
    const scheduler = new RetryScheduler(
      repo,
      { ...RETRY_SCHEDULER_DEFAULTS, jitter: false },
      discordService
    );

    await scheduler.runOnce();

    const row = await db.get<{ status: string; retry_count: number }>(
      'SELECT status, retry_count FROM scheduled_notifications WHERE id = ?',
      [id]
    );

    expect(row!.status).toBe(NotificationStatus.FAILED);
    expect(row!.retry_count).toBe(4);
  });

  it('does not pick up a notification whose next_retry_at is in the future', async () => {
    const futureRetryAt = new Date(Date.now() + 60_000);
    await insertFailedNotification(repo, db, 1, futureRetryAt);

    const discordService = { sendEventNotification: jest.fn() } as any;
    const scheduler = new RetryScheduler(
      repo,
      { ...RETRY_SCHEDULER_DEFAULTS },
      discordService
    );

    await scheduler.runOnce();

    expect(discordService.sendEventNotification).not.toHaveBeenCalled();
  });

  it('does not pick up first-attempt notifications (retry_count === 0)', async () => {
    // Fresh notification with no prior failures
    await repo.create({
      payload: { event: {}, contractConfig: {} },
      notificationType: NotificationType.DISCORD,
      targetRecipient: 'recipient',
      executeAt: new Date(Date.now() - 1000),
    });

    const discordService = { sendEventNotification: jest.fn() } as any;
    const scheduler = new RetryScheduler(repo, { ...RETRY_SCHEDULER_DEFAULTS }, discordService);

    await scheduler.runOnce();

    expect(discordService.sendEventNotification).not.toHaveBeenCalled();
  });

  it('prevents duplicate processing via distributed lock', async () => {
    const id = await insertFailedNotification(repo, db, 1, null);

    let resolveFirst!: (value: boolean) => void;
    const firstDeliveryBarrier = new Promise<boolean>((res) => { resolveFirst = res; });

    const callOrder: string[] = [];
    const discordService = {
      sendEventNotification: jest.fn()
        .mockImplementationOnce(async () => {
          callOrder.push('first-start');
          const result = await firstDeliveryBarrier;
          callOrder.push('first-end');
          return result;
        })
        .mockResolvedValue(true),
    } as any;

    const s1 = new RetryScheduler(repo, { ...RETRY_SCHEDULER_DEFAULTS, jitter: false }, discordService);
    const s2 = new RetryScheduler(repo, { ...RETRY_SCHEDULER_DEFAULTS, jitter: false }, discordService);

    // s1 starts processing but hasn't finished delivery yet
    const p1 = s1.runOnce();
    // s2 tries to pick up the same notification — should get nothing (locked)
    await s2.runOnce();
    // Now s1 finishes
    resolveFirst(true);
    await p1;

    // Only one scheduler should have delivered
    expect(discordService.sendEventNotification).toHaveBeenCalledTimes(1);

    const row = await db.get<{ status: string }>(
      'SELECT status FROM scheduled_notifications WHERE id = ?',
      [id]
    );
    expect(row!.status).toBe(NotificationStatus.COMPLETED);
  });
});
