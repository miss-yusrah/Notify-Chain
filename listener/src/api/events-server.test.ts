import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import http from 'http';
import crypto from 'crypto';
import { createEventsServer, checkStellarRpc, checkDiscord } from './events-server';
import { eventRegistry } from '../store/event-registry';

const mockGetHealth = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: mockGetHealth,
    })),
  },
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
    server = createEventsServer({ port: 0, stellarRpcUrl: 'http://localhost' });
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

const BASE_OPTIONS = { port: 0, stellarRpcUrl: 'https://test' };

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
