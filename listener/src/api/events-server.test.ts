import http from 'http';
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
