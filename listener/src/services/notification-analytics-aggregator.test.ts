import { NotificationType } from '../types/scheduled-notification';
import {
  AnalyticsDeliveryOutcome,
  NotificationAnalyticsAggregator,
} from './notification-analytics-aggregator';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const HOUR = 60 * 60 * 1000;
const fixedNow = 1_700_000_000_000;

function buildRecord(
  outcome: AnalyticsDeliveryOutcome,
  overrides: Partial<{
    notificationType: NotificationType;
    contractAddress: string;
    durationMs: number;
    errorReason: string;
    timestamp: number;
  }> = {},
) {
  return {
    notificationType: NotificationType.DISCORD,
    outcome,
    durationMs: 100,
    timestamp: fixedNow,
    ...overrides,
  };
}

describe('NotificationAnalyticsAggregator', () => {
  let aggregator: NotificationAnalyticsAggregator;

  beforeEach(() => {
    jest.clearAllMocks();
    aggregator = new NotificationAnalyticsAggregator({
      bucketSizeMs: HOUR,
      maxBuckets: 3,
      topContractsLimit: 5,
      topErrorsLimit: 3,
      now: () => fixedNow,
    });
  });

  describe('record + lifetimeCount', () => {
    it('increments lifetime and current size', () => {
      aggregator.record(buildRecord('success'));
      aggregator.record(buildRecord('failure'));
      expect(aggregator.lifetimeCount).toBe(2);
      expect(aggregator.size).toBe(2);
    });

    it('evicts oldest when maxRecords is exceeded', () => {
      const small = new NotificationAnalyticsAggregator({
        maxRecords: 3,
        now: () => fixedNow,
      });
      for (let i = 0; i < 5; i++) {
        small.record(
          buildRecord('success', {
            timestamp: fixedNow + i,
            contractAddress: `c${i}`,
          }),
        );
      }
      expect(small.lifetimeCount).toBe(5);
      expect(small.size).toBe(3);
    });

    it('preserves lifetimeCount after eviction', () => {
      const small = new NotificationAnalyticsAggregator({ maxRecords: 2 });
      for (let i = 0; i < 5; i++) small.record(buildRecord('success'));
      expect(small.lifetimeCount).toBe(5);
      expect(small.size).toBe(2);
    });
  });

  describe('outcome classification', () => {
    it('tallies all four outcomes', () => {
      aggregator.record(buildRecord('success'));
      aggregator.record(buildRecord('failure', { errorReason: '429' }));
      aggregator.record(buildRecord('retry'));
      aggregator.record(buildRecord('skipped'));
      const snap = aggregator.snapshot();
      expect(snap.overall).toEqual(
        expect.objectContaining({
          total: 4,
          success: 1,
          failure: 1,
          retry: 1,
          skipped: 1,
        }),
      );
    });

    it('computes successRate as success / (success+failure)', () => {
      aggregator.record(buildRecord('success'));
      aggregator.record(buildRecord('success'));
      aggregator.record(buildRecord('failure'));
      aggregator.record(buildRecord('retry'));
      const snap = aggregator.snapshot();
      // 2 success, 1 failure, 1 retry => successRate = 2/3
      expect(snap.overall.successRate).toBeCloseTo(2 / 3, 5);
    });

    it('returns 0 successRate when no terminal outcomes', () => {
      aggregator.record(buildRecord('retry'));
      aggregator.record(buildRecord('skipped'));
      const snap = aggregator.snapshot();
      expect(snap.overall.successRate).toBe(0);
    });
  });

  describe('average duration', () => {
    it('computes mean over positive durations only', () => {
      aggregator.record(buildRecord('success', { durationMs: 100 }));
      aggregator.record(buildRecord('success', { durationMs: 300 }));
      aggregator.record(buildRecord('success', { durationMs: 0 }));
      const snap = aggregator.snapshot();
      expect(snap.overall.averageDurationMs).toBe(200);
    });

    it('returns 0 when no records have positive duration', () => {
      aggregator.record(buildRecord('success', { durationMs: 0 }));
      const snap = aggregator.snapshot();
      expect(snap.overall.averageDurationMs).toBe(0);
    });
  });

  describe('byType', () => {
    it('groups records by notificationType', () => {
      aggregator.record(buildRecord('success', { notificationType: NotificationType.DISCORD }));
      aggregator.record(buildRecord('success', { notificationType: NotificationType.DISCORD }));
      aggregator.record(buildRecord('failure', { notificationType: NotificationType.EMAIL }));
      aggregator.record(buildRecord('success', { notificationType: NotificationType.WEBHOOK }));
      const snap = aggregator.snapshot();
      const discord = snap.byType.find((b) => b.notificationType === NotificationType.DISCORD);
      const email = snap.byType.find((b) => b.notificationType === NotificationType.EMAIL);
      const webhook = snap.byType.find((b) => b.notificationType === NotificationType.WEBHOOK);
      expect(discord).toMatchObject({ total: 2, success: 2, failure: 0, successRate: 1 });
      expect(email).toMatchObject({ total: 1, success: 0, failure: 1, successRate: 0 });
      expect(webhook).toMatchObject({ total: 1, success: 1, failure: 0, successRate: 1 });
    });

    it('sorts by total descending', () => {
      aggregator.record(buildRecord('success', { notificationType: NotificationType.EMAIL }));
      aggregator.record(buildRecord('success', { notificationType: NotificationType.DISCORD }));
      aggregator.record(buildRecord('success', { notificationType: NotificationType.DISCORD }));
      aggregator.record(buildRecord('success', { notificationType: NotificationType.DISCORD }));
      const snap = aggregator.snapshot();
      expect(snap.byType.map((b) => b.notificationType)).toEqual([
        NotificationType.DISCORD,
        NotificationType.EMAIL,
      ]);
    });
  });

  describe('byContract', () => {
    it('groups by contract address and skips records without one', () => {
      aggregator.record(buildRecord('success', { contractAddress: 'CB1' }));
      aggregator.record(buildRecord('success', { contractAddress: 'CB1' }));
      aggregator.record(buildRecord('failure', { contractAddress: 'CB2' }));
      aggregator.record(buildRecord('success')); // no contract
      const snap = aggregator.snapshot();
      expect(snap.byContract).toHaveLength(2);
      const cb1 = snap.byContract.find((b) => b.contractAddress === 'CB1')!;
      const cb2 = snap.byContract.find((b) => b.contractAddress === 'CB2')!;
      expect(cb1).toMatchObject({ total: 2, success: 2, failure: 0, successRate: 1 });
      expect(cb2).toMatchObject({ total: 1, success: 0, failure: 1, successRate: 0 });
    });

    it('caps at topContractsLimit', () => {
      const limited = new NotificationAnalyticsAggregator({
        topContractsLimit: 2,
        now: () => fixedNow,
      });
      for (let i = 0; i < 5; i++) {
        limited.record(
          buildRecord('success', { contractAddress: `CB${i}`, timestamp: fixedNow + i }),
        );
      }
      const snap = limited.snapshot();
      expect(snap.byContract).toHaveLength(2);
    });
  });

  describe('hourly buckets', () => {
    it('builds contiguous hourly buckets across the rolling window', () => {
      const small = new NotificationAnalyticsAggregator({
        bucketSizeMs: HOUR,
        maxBuckets: 3,
        now: () => fixedNow,
      });
      small.record(buildRecord('success', { timestamp: fixedNow - HOUR * 2 }));
      small.record(buildRecord('failure', { timestamp: fixedNow - HOUR }));
      small.record(buildRecord('success', { timestamp: fixedNow }));
      const snap = small.snapshot();
      // 3 buckets: [-2h, -1h, 0h] anchored at the current bucket start
      expect(snap.hourlyBuckets).toHaveLength(3);
      expect(snap.hourlyBuckets[0]).toMatchObject({ total: 1, success: 1 });
      expect(snap.hourlyBuckets[1]).toMatchObject({ total: 1, failure: 1 });
      expect(snap.hourlyBuckets[2]).toMatchObject({ total: 1, success: 1 });
    });

    it('averages duration within each bucket', () => {
      const small = new NotificationAnalyticsAggregator({
        bucketSizeMs: HOUR,
        maxBuckets: 2,
        now: () => fixedNow,
      });
      small.record(buildRecord('success', { timestamp: fixedNow, durationMs: 100 }));
      small.record(buildRecord('success', { timestamp: fixedNow + 5, durationMs: 300 }));
      const snap = small.snapshot();
      const lastBucket = snap.hourlyBuckets[snap.hourlyBuckets.length - 1];
      expect(lastBucket.averageDurationMs).toBe(200);
    });
  });

  describe('errorBreakdown', () => {
    it('counts failure reasons and sorts descending', () => {
      aggregator.record(buildRecord('failure', { errorReason: '429' }));
      aggregator.record(buildRecord('failure', { errorReason: '429' }));
      aggregator.record(buildRecord('failure', { errorReason: 'timeout' }));
      aggregator.record(buildRecord('failure')); // unknown
      const snap = aggregator.snapshot();
      expect(snap.errorBreakdown['429']).toBe(2);
      expect(snap.errorBreakdown['timeout']).toBe(1);
      expect(snap.errorBreakdown['unknown']).toBe(1);
    });

    it('honors topErrorsLimit and aggregates overflow under __other', () => {
      const limited = new NotificationAnalyticsAggregator({
        topErrorsLimit: 2,
        now: () => fixedNow,
      });
      limited.record(buildRecord('failure', { errorReason: 'a' }));
      limited.record(buildRecord('failure', { errorReason: 'a' }));
      limited.record(buildRecord('failure', { errorReason: 'a' }));
      limited.record(buildRecord('failure', { errorReason: 'b' }));
      limited.record(buildRecord('failure', { errorReason: 'b' }));
      limited.record(buildRecord('failure', { errorReason: 'c' }));
      const snap = limited.snapshot();
      expect(snap.errorBreakdown['a']).toBe(3);
      expect(snap.errorBreakdown['b']).toBe(2);
      expect(snap.errorBreakdown['c']).toBeUndefined();
      expect(snap.errorBreakdown['__other']).toBe(1);
    });

    it('ignores non-failure outcomes', () => {
      aggregator.record(buildRecord('success', { errorReason: 'should-not-count' }));
      aggregator.record(buildRecord('retry', { errorReason: 'should-not-count' }));
      const snap = aggregator.snapshot();
      expect(Object.keys(snap.errorBreakdown)).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('clears records and counters', () => {
      aggregator.record(buildRecord('success'));
      aggregator.record(buildRecord('failure'));
      aggregator.reset();
      expect(aggregator.lifetimeCount).toBe(0);
      expect(aggregator.size).toBe(0);
      const snap = aggregator.snapshot();
      expect(snap.overall.total).toBe(0);
      expect(snap.overall.success).toBe(0);
    });
  });

  describe('windowing', () => {
    it('drops records older than maxBuckets * bucketSizeMs from now', () => {
      const small = new NotificationAnalyticsAggregator({
        bucketSizeMs: HOUR,
        maxBuckets: 1, // 1-hour window
        now: () => fixedNow,
      });
      // 2h ago — outside window
      small.record(buildRecord('success', { timestamp: fixedNow - 2 * HOUR }));
      // inside window
      small.record(buildRecord('success', { timestamp: fixedNow }));
      const snap = small.snapshot();
      expect(snap.overall.total).toBe(1);
    });
  });
});
