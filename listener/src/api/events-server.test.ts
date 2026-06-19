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

jest.mock('../store/event-registry', () => ({
  eventRegistry: {
    getEvents: jest.fn().mockReturnValue([]),
    count: jest.fn().mockReturnValue(0),
    addFromInput: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const BASE_OPTIONS = {
  port: 0,
  stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
};

function makeRequest(
  server: http.Server,
  path: string
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function startServer(options: Parameters<typeof createEventsServer>[0]): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = createEventsServer(options);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('GET /health', () => {
  let server: http.Server;

  beforeEach(() => {
    jest.clearAllMocks();
    (eventRegistry.count as jest.Mock).mockReturnValue(5);
  });

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('returns 200 and status ok when all services are healthy', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });

    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makeRequest(server, '/health');

    expect(status).toBe(200);
    expect((body as any).status).toBe('ok');
    expect((body as any).services.stellarRpc.status).toBe('ok');
    expect((body as any).services.discord.status).toBe('not_configured');
    expect((body as any).services.eventRegistry).toEqual({ status: 'ok', eventCount: 5 });
    expect((body as any).timestamp).toBeDefined();
  });

  it('returns 503 and status error when Stellar RPC is unreachable', async () => {
    mockGetHealth.mockRejectedValue(new Error('connection refused'));

    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makeRequest(server, '/health');

    expect(status).toBe(503);
    expect((body as any).status).toBe('error');
    expect((body as any).services.stellarRpc.status).toBe('error');
    expect((body as any).services.stellarRpc.detail).toBe('connection refused');
  });

  it('returns 200 and status degraded when Discord webhook is down', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    server = await startServer({
      ...BASE_OPTIONS,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    const { status, body } = await makeRequest(server, '/health');

    expect(status).toBe(200);
    expect((body as any).status).toBe('degraded');
    expect((body as any).services.discord.status).toBe('error');
    expect((body as any).services.discord.detail).toBe('HTTP 503');
  });

  it('returns 200 and status ok when Discord webhook is reachable', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    server = await startServer({
      ...BASE_OPTIONS,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    const { status, body } = await makeRequest(server, '/health');

    expect(status).toBe(200);
    expect((body as any).status).toBe('ok');
    expect((body as any).services.discord.status).toBe('ok');
  });

  it('includes latencyMs for each checked service', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    server = await startServer({
      ...BASE_OPTIONS,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    const { body } = await makeRequest(server, '/health');

    expect(typeof (body as any).services.stellarRpc.latencyMs).toBe('number');
    expect(typeof (body as any).services.discord.latencyMs).toBe('number');
  });

  it('reports discord as not_configured when no webhook url is provided', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });

    server = await startServer(BASE_OPTIONS);
    const { body } = await makeRequest(server, '/health');

    expect((body as any).services.discord).toEqual({ status: 'not_configured' });
  });
});

describe('checkStellarRpc', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns ok when getHealth resolves', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    const result = await checkStellarRpc('https://soroban-testnet.stellar.org:443');
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns error when getHealth rejects', async () => {
    mockGetHealth.mockRejectedValue(new Error('timeout'));
    const result = await checkStellarRpc('https://soroban-testnet.stellar.org:443');
    expect(result.status).toBe('error');
    expect(result.detail).toBe('timeout');
  });
});

describe('checkDiscord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns ok for a 200 response', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const result = await checkDiscord('https://discord.com/api/webhooks/123/abc');
    expect(result.status).toBe('ok');
  });

  it('returns error for a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await checkDiscord('https://discord.com/api/webhooks/123/abc');
    expect(result.status).toBe('error');
    expect(result.detail).toBe('HTTP 401');
  });

  it('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await checkDiscord('https://discord.com/api/webhooks/123/abc');
    expect(result.status).toBe('error');
    expect(result.detail).toBe('network error');
  });
});

describe('GET /api/events', () => {
  let server: http.Server;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    (eventRegistry.getEvents as jest.Mock).mockReturnValue([{ id: '1' }]);
    (eventRegistry.count as jest.Mock).mockReturnValue(1);
  });

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('returns events list', async () => {
    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makeRequest(server, '/api/events');

    expect(status).toBe(200);
    expect((body as any).count).toBe(1);
    expect((body as any).events).toHaveLength(1);
  });
});

describe('unknown routes', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('returns 404 for unknown path', async () => {
    server = await startServer(BASE_OPTIONS);
    const { status, body } = await makeRequest(server, '/unknown');

    expect(status).toBe(404);
    expect((body as any).error).toBe('Not found');
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
