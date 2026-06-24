import http from 'http';
import { createEventsServer } from './events-server';
import { Database } from '../database/database';
import { NotificationTemplateRepository } from '../services/notification-template-repository';
import { NotificationTemplateService } from '../services/notification-template-service';
import { TemplateAuditTrail } from '../services/template-audit-trail';
import { NotificationTemplateCache } from '../services/notification-template-cache';
import { parseTemplateUpdateBody } from './template-api';
import { resolveRequestActor } from '../utils/request-actor';

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    })),
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

function request(
  server: http.Server,
  method: string,
  path: string,
  options?: {
    body?: object;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as { port: number }).port;
    const payload = options?.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers ?? {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({
          status: res.statusCode!,
          body: data ? JSON.parse(data) : null,
        }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createTemplateService(): Promise<{
  db: Database;
  service: NotificationTemplateService;
}> {
  const db = new Database(':memory:');
  await db.initialize();
  const cache = new NotificationTemplateCache(60, 0);
  const repository = new NotificationTemplateRepository(db, new TemplateAuditTrail(db), cache);
  const service = new NotificationTemplateService(repository, cache);
  return { db, service };
}

describe('Template API endpoints', () => {
  let db: Database;
  let service: NotificationTemplateService;
  let server: http.Server;

  beforeEach(async () => {
    ({ db, service } = await createTemplateService());
    server = createEventsServer({
      port: 0,
      stellarRpcUrl: 'http://localhost',
      templateService: service,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    await service.create({
      id: 'welcome-email',
      name: 'Welcome Email',
      type: 'email',
      subject: 'Welcome',
      body: 'Hello {{name}}',
      variables: ['name'],
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await db.close();
  });

  it('PUT /api/templates/:id updates via repository and records actor from x-api-key', async () => {
    const res = await request(server, 'PUT', '/api/templates/welcome-email', {
      headers: { 'x-api-key': 'admin-key-123' },
      body: { body: 'Hello {{name}}, welcome aboard!' },
    });

    expect(res.status).toBe(200);
    expect((res.body as { body: string }).body).toBe('Hello {{name}}, welcome aboard!');

    const audit = await service.getAuditHistory('welcome-email');
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe('api-key:admin-key-123');
  });

  it('GET /api/templates/:id/audit returns update history', async () => {
    await request(server, 'PUT', '/api/templates/welcome-email', {
      headers: { Authorization: 'Bearer editor-token' },
      body: { name: 'Welcome Email v2' },
    });

    const res = await request(server, 'GET', '/api/templates/welcome-email/audit');

    expect(res.status).toBe(200);
    const body = res.body as { templateId: string; records: Array<{ actor: string; action: string }> };
    expect(body.templateId).toBe('welcome-email');
    expect(body.records).toHaveLength(1);
    expect(body.records[0].actor).toBe('bearer:editor-token');
    expect(body.records[0].action).toBe('UPDATE');
  });

  it('GET /api/templates/:id returns a template through the cache-backed service', async () => {
    const res = await request(server, 'GET', '/api/templates/welcome-email');
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('welcome-email');
  });

  it('POST /api/templates creates a template', async () => {
    const res = await request(server, 'POST', '/api/templates', {
      body: {
        id: 'digest',
        name: 'Daily Digest',
        type: 'email',
        body: 'Your daily summary',
      },
    });

    expect(res.status).toBe(201);
    expect((res.body as { id: string }).id).toBe('digest');
  });

  it('returns 404 when updating a missing template', async () => {
    const res = await request(server, 'PUT', '/api/templates/missing', {
      headers: { 'x-api-key': 'admin' },
      body: { body: 'Nope' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for audit history on a missing template', async () => {
    const res = await request(server, 'GET', '/api/templates/missing/audit');
    expect(res.status).toBe(404);
  });

  it('returns 400 for an empty update body', async () => {
    const res = await request(server, 'PUT', '/api/templates/welcome-email', {
      headers: { 'x-api-key': 'admin' },
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when template service is not configured', async () => {
    const disabledServer = createEventsServer({
      port: 0,
      stellarRpcUrl: 'http://localhost',
    });
    await new Promise<void>((resolve) => disabledServer.listen(0, '127.0.0.1', () => resolve()));

    const res = await request(disabledServer, 'PUT', '/api/templates/welcome-email', {
      body: { body: 'Blocked' },
    });

    expect(res.status).toBe(503);
    await new Promise<void>((resolve, reject) => disabledServer.close((err) => (err ? reject(err) : resolve())));
  });
});

describe('template-api helpers', () => {
  it('parseTemplateUpdateBody rejects empty updates', () => {
    expect(() => parseTemplateUpdateBody({})).toThrow('at least one template field');
  });

  it('resolveRequestActor prefers API key identity', () => {
    const actor = resolveRequestActor({
      headers: { 'x-api-key': 'secret' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as http.IncomingMessage);
    expect(actor).toBe('api-key:secret');
  });
});
