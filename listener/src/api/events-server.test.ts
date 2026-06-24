import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import http from 'http';
import crypto from 'crypto';
import { createEventsServer, checkStellarRpc, checkDiscord } from './events-server';
import { eventRegistry } from '../store/event-registry';
import { NotificationAnalyticsAggregator } from '../services/notification-analytics-aggregator';
import { NotificationType } from '../types/scheduled-notification';

const mockGetHealth = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockIsSuccessfulSim = jest.fn();
const mockKeypairRandom = jest.fn(() => ({ publicKey: () => 'GAXXX' }));
const mockContractCall = jest.fn();
const mockTxBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({}),
};
const mockTransactionBuilder = jest.fn(() => mockTxBuilder);

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: mockGetHealth,
      simulateTransaction: mockSimulateTransaction,
      getAccount: jest.fn().mockRejectedValue(new Error('not found')),
    })),
    isSuccessfulSim: mockIsSuccessfulSim,
  },
  Keypair: { random: mockKeypairRandom },
  Account: jest.fn(),
  Contract: jest.fn(() => ({ call: mockContractCall })),
  TransactionBuilder: mockTransactionBuilder,
  BASE_FEE: '100',
  scValToNative: jest.fn(),
}));
import { preferenceStore } from '../store/preference-store';

jest.mock('../store/preference-store', () => {
  const store = {
    get: jest.fn(),
    update: jest.fn(),
    isCategoryEnabled: jest.fn(),
  };
  return { preferenceStore: store };
});

jest.mock('../store/event-registry', () => ({
  eventRegistry: { getEvents: jest.fn(() => []), count: jest.fn(() => 0) },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockStore = preferenceStore as jest.Mocked<typeof preferenceStore>;

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as { port: number }).port;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method,
        headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Preference API endpoints', () => {
  let server: http.Server;

  beforeEach((done) => {
    jest.clearAllMocks();
    server = createEventsServer({ 
      port: 0, 
      stellarRpcUrl: 'http://localhost', 
      stellarNetworkPassphrase: 'Test SDF Network ; September 2015', 
      contractAddresses: [] 
    });
    server.listen(0, '127.0.0.1', done);
  });

  afterEach((done) => {
    server.close(done);
  });

  describe('GET /api/preferences/:userId', () => {
    it('returns preferences for the given user', async () => {
      const prefs = { userId: 'alice', categories: { discord: true }, updatedAt: 1000 };
      mockStore.get.mockReturnValue(prefs);

      const res = await request(server, 'GET', '/api/preferences/alice');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(prefs);
      expect(mockStore.get).toHaveBeenCalledWith('alice');
    });
  });

  describe('PUT /api/preferences/:userId', () => {
    it('updates and returns preferences', async () => {
      const updated = { userId: 'alice', categories: { discord: false }, updatedAt: 2000 };
      mockStore.update.mockReturnValue(updated);

      const res = await request(server, 'PUT', '/api/preferences/alice', {
        categories: { discord: false },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mockStore.update).toHaveBeenCalledWith('alice', { categories: { discord: false } });
    });

    it('returns 400 for invalid JSON body', async () => {
      const port = (server.address() as { port: number }).port;
      const res = await new Promise<{ status: number }>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/api/preferences/alice', method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': 8 } },
          (r) => {
            r.resume();
            r.on('end', () => resolve({ status: r.statusCode! }));
          }
        );
        req.on('error', reject);
        req.write('not-json');
        req.end();
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when categories field is missing', async () => {
      const res = await request(server, 'PUT', '/api/preferences/alice', { foo: 'bar' });
      expect(res.status).toBe(400);
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for unrecognised paths', async () => {
      const res = await request(server, 'GET', '/api/unknown');
      expect(res.status).toBe(404);
    });
  });
});

function computeSignature(payload: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `sha256=${sig}`;
}

function makePostRequest(
  server: http.Server,
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function startServer(options: any): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = createEventsServer(options);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function closeServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

const BASE_OPTIONS = { 
  port: 0, 
  stellarRpcUrl: 'https://test', 
  stellarNetworkPassphrase: 'Test SDF Network ; September 2015', 
  contractAddresses: [] 
};

describe('POST /api/webhooks', () => {
  let server: http.Server;
  const secrets = [
    { id: 'key-1', secret: 'whsec_test_secret' },
    { id: 'key-2', secret: 'whsec_other_secret' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('accepts a webhook with a valid signature', async () => {
    const payload = JSON.stringify({ event: 'test', data: { foo: 'bar' } });
    const signature = computeSignature(payload, 'whsec_test_secret');

    server = await startServer({ ...BASE_OPTIONS, webhookSecrets: secrets });
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Signature': signature,
      'X-Webhook-Key-Id': 'key-1',
    });

    expect(status).toBe(202);
    expect((body as any).status).toBe('accepted');
  });

  it('rejects a webhook with an invalid signature', async () => {
    const payload = JSON.stringify({ event: 'test' });

    server = await startServer({ ...BASE_OPTIONS, webhookSecrets: secrets });
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Signature': 'sha256=invalid',
      'X-Webhook-Key-Id': 'key-1',
    });

    expect(status).toBe(401);
    expect((body as any).error).toBe('Invalid signature');
  });

  it('rejects when signature header is missing', async () => {
    const payload = JSON.stringify({ event: 'test' });

    server = await startServer({ ...BASE_OPTIONS, webhookSecrets: secrets });
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Key-Id': 'key-1',
    });

    expect(status).toBe(401);
    expect((body as any).error).toBe('Missing signature header');
  });

  it('rejects when key-id header is missing', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const signature = computeSignature(payload, 'whsec_test_secret');

    server = await startServer({ ...BASE_OPTIONS, webhookSecrets: secrets });
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Signature': signature,
    });

    expect(status).toBe(401);
    expect((body as any).error).toBe('Missing key-id header');
  });

  it('rejects when key-id is unknown', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const signature = computeSignature(payload, 'whsec_test_secret');

    server = await startServer({ ...BASE_OPTIONS, webhookSecrets: secrets });
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Signature': signature,
      'X-Webhook-Key-Id': 'unknown-key',
    });

    expect(status).toBe(401);
    expect((body as any).error).toBe('Unknown key-id');
  });

  it('rejects when no webhook secrets are configured', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const signature = computeSignature(payload, 'whsec_test_secret');

    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makePostRequest(server, '/api/webhooks', payload, {
      'X-Webhook-Signature': signature,
      'X-Webhook-Key-Id': 'key-1',
    });

    expect(status).toBe(401);
    expect((body as any).error).toBe('Unknown key-id');
  });

  it('returns 404 for POST to other paths', async () => {
    const payload = JSON.stringify({ event: 'test' });

    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makePostRequest(server, '/api/events', payload, {});

    expect(status).toBe(404);
  });
});

describe('GET /api/analytics', () => {
  let server: http.Server;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null as unknown as http.Server;
    }
  });

  it('returns an empty snapshot when no records are recorded', async () => {
    const aggregator = new NotificationAnalyticsAggregator();
    aggregator.reset();
    server = await startServer({ ...BASE_OPTIONS, analyticsAggregator: aggregator });

    const res = await request(server, 'GET', '/api/analytics');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.totalRecorded).toBe(0);
    expect(body.windowStart).toBeDefined();
    expect(body.windowEnd).toBeDefined();
    expect(body.overall).toBeDefined();
    expect(body.byType).toEqual([]);
    expect(body.byContract).toEqual([]);
    // hourlyBuckets is a fixed-size rolling window: when there are no records
    // every bucket still exists with zero counters. We assert structure rather
    // than emptiness so the test is robust to bucket-count changes.
    expect(Array.isArray(body.hourlyBuckets)).toBe(true);
    expect((body.hourlyBuckets as unknown[]).length).toBeGreaterThan(0);
    for (const bucket of body.hourlyBuckets as Array<{ total: number; success: number; failure: number }>) {
      expect(bucket.total).toBe(0);
      expect(bucket.success).toBe(0);
      expect(bucket.failure).toBe(0);
    }
    expect(body.errorBreakdown).toEqual({});
  });

  it('returns aggregated metrics from recorded outcomes', async () => {
    const aggregator = new NotificationAnalyticsAggregator({ bucketSizeMs: 60_000 });
    aggregator.reset();
    const now = Date.now();
    const baseTs = now;
    aggregator.record({
      notificationType: NotificationType.DISCORD,
      contractAddress: 'CABC',
      outcome: 'success',
      durationMs: 120,
      timestamp: baseTs,
    });
    aggregator.record({
      notificationType: NotificationType.DISCORD,
      contractAddress: 'CABC',
      outcome: 'failure',
      durationMs: 240,
      errorReason: 'HTTP 500',
      timestamp: baseTs + 1000,
    });
    aggregator.record({
      notificationType: NotificationType.WEBHOOK,
      outcome: 'retry',
      durationMs: 0,
      timestamp: baseTs + 2000,
    });
    server = await startServer({ ...BASE_OPTIONS, analyticsAggregator: aggregator });

    const res = await request(server, 'GET', '/api/analytics');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, any>;
    expect(body.totalRecorded).toBe(3);
    expect(body.byType.length).toBeGreaterThan(0);
    const discordRow = body.byType.find(
      (r: any) => r.notificationType === NotificationType.DISCORD,
    );
    expect(discordRow).toBeDefined();
    expect(discordRow.total).toBe(2);
    expect(discordRow.success).toBe(1);
    expect(discordRow.failure).toBe(1);
    expect(discordRow.successRate).toBeCloseTo(0.5);
    const contractRow = body.byContract.find(
      (r: any) => r.contractAddress === 'CABC',
    );
    expect(contractRow).toBeDefined();
    expect(contractRow.total).toBe(2);
    expect(body.errorBreakdown['HTTP 500']).toBe(1);
  });

  it('clears aggregator state when reset=true is supplied', async () => {
    const aggregator = new NotificationAnalyticsAggregator();
    aggregator.reset();
    aggregator.record({
      notificationType: NotificationType.DISCORD,
      outcome: 'success',
      durationMs: 50,
      timestamp: Date.now(),
    });
    server = await startServer({ ...BASE_OPTIONS, analyticsAggregator: aggregator });

    const first = await request(server, 'GET', '/api/analytics');
    expect((first.body as any).totalRecorded).toBe(1);

    const reset = await request(server, 'GET', '/api/analytics?reset=true');
    expect(reset.status).toBe(200);
    expect((reset.body as any).totalRecorded).toBe(1); // snapshot returned BEFORE reset

    const after = await request(server, 'GET', '/api/analytics');
    expect((after.body as any).totalRecorded).toBe(0);
  });
});
