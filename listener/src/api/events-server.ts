import http from 'http';
import * as StellarSDK from '@stellar/stellar-sdk';
import { eventRegistry } from '../store/event-registry';
import { preferenceStore } from '../store/preference-store';
import { PreferencesUpdateInput } from '../types/preferences';
import logger from '../utils/logger';
import { generateRequestId } from '../utils/request-id';
import { RateLimitConfig } from '../types';
import { RateLimiter } from './rate-limiter';

export interface EventsServerOptions {
  port: number;
  corsOrigin?: string;
  stellarRpcUrl: string;
  discordWebhookUrl?: string;
  notificationAPI?: NotificationAPI | null;
  rateLimit?: RateLimitConfig;
}

type ServiceStatus = 'ok' | 'error' | 'not_configured';

interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  services: {
    stellarRpc: ServiceHealth;
    discord: ServiceHealth;
    eventRegistry: { status: ServiceStatus; eventCount: number };
  };
}

const HEALTH_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timed out')), ms)
    ),
  ]);
}

export async function checkStellarRpc(rpcUrl: string): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const server = new StellarSDK.rpc.Server(rpcUrl);
    await withTimeout(server.getHealth(), HEALTH_TIMEOUT_MS);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkDiscord(webhookUrl: string): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch(webhookUrl, { method: 'GET' }),
      HEALTH_TIMEOUT_MS
    );
    if (response.ok) {
      return { status: 'ok', latencyMs: Date.now() - start };
    }
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      detail: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function buildHealthResponse(options: EventsServerOptions): Promise<HealthResponse> {
  const [stellarRpc, discord] = await Promise.all([
    checkStellarRpc(options.stellarRpcUrl),
    options.discordWebhookUrl
      ? checkDiscord(options.discordWebhookUrl)
      : Promise.resolve<ServiceHealth>({ status: 'not_configured' }),
  ]);

  const eventRegistryHealth = {
    status: 'ok' as ServiceStatus,
    eventCount: eventRegistry.count(),
  };

  let overallStatus: HealthResponse['status'];
  if (stellarRpc.status === 'error') {
    overallStatus = 'error';
  } else if (discord.status === 'error') {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'ok';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      stellarRpc,
      discord,
      eventRegistry: eventRegistryHealth,
    },
  };
}

export function createEventsServer(options: EventsServerOptions): http.Server {
  const corsOrigin = options.corsOrigin ?? 'http://localhost:5173';
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : undefined;

  const server = http.createServer((req, res) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    // GET /api/events
    if (req.method === 'GET' && url.pathname.startsWith('/api/events')) {
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const events =
        limit !== undefined && !Number.isNaN(limit)
          ? eventRegistry.getEvents(limit)
          : eventRegistry.getEvents();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: eventRegistry.count(), events }));
      return;
    }

    // GET /api/preferences/:userId
    const getPrefsMatch = url.pathname.match(/^\/api\/preferences\/([^/]+)$/);
    if (req.method === 'GET' && getPrefsMatch) {
      const userId = decodeURIComponent(getPrefsMatch[1]);
      const prefs = preferenceStore.get(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(prefs));
      return;
    }

    // PUT /api/preferences/:userId
    const putPrefsMatch = url.pathname.match(/^\/api\/preferences\/([^/]+)$/);
    if (req.method === 'PUT' && putPrefsMatch) {
      const userId = decodeURIComponent(putPrefsMatch[1]);
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const input: PreferencesUpdateInput = JSON.parse(body);
          if (!input || typeof input.categories !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid body: expected { categories: { [key]: boolean } }' }));
            return;
          }
          const updated = preferenceStore.update(userId, input);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
  });

  if (rateLimiter) {
    const originalClose = server.close.bind(server);
    server.close = (callback?: (err?: Error) => void) => {
      rateLimiter.destroy();
      return originalClose(callback);
    };
  }

  return server;
}

export function startEventsServer(options: EventsServerOptions): http.Server {
  const server = createEventsServer(options);
  server.listen(options.port, () => {
    logger.info('Events API server listening', { port: options.port });
  });
  return server;
}
