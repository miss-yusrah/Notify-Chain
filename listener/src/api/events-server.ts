import http from 'http';
import * as StellarSDK from '@stellar/stellar-sdk';
import { eventRegistry } from '../store/event-registry';
import { preferenceStore } from '../store/preference-store';
import { PreferencesUpdateInput } from '../types/preferences';
import { NotificationAPI } from '../services/notification-api';
import { NotificationType } from '../types/scheduled-notification';
import logger from '../utils/logger';
import { generateRequestId, resolveCorrelationId } from '../utils/request-id';
import { NotificationHistoryService } from '../services/notification-history';
import {
  verifySignature,
  extractSignature,
  extractKeyId,
  getSecretForKey,
  collectRawBody,
} from '../services/webhook-verifier';
import { WebhookSecret, RateLimitConfig } from '../types';
import { RateLimiter } from './rate-limiter';
import {
  getNotificationAnalyticsAggregator,
  setNotificationAnalyticsAggregator,
  NotificationAnalyticsAggregator,
} from '../services/notification-analytics-aggregator';

export interface EventsServerOptions {
  port: number;
  corsOrigin?: string;
  stellarRpcUrl: string;
  discordWebhookUrl?: string;
  webhookSecrets?: WebhookSecret[];
  notificationAPI?: NotificationAPI | null;
  rateLimit?: RateLimitConfig;
  /**
   * Optional override for the analytics aggregator. Tests use this to inject
   * a controlled instance and reset state between cases. When omitted, the
   * process-wide default aggregator is used.
   */
  analyticsAggregator?: NotificationAnalyticsAggregator | null;
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
  const historyService = new NotificationHistoryService();
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : undefined;

  const server = http.createServer(async (req, res) => {
    const requestId = generateRequestId();
    const correlationId = resolveCorrelationId(req.headers['x-correlation-id']);
    const startTime = Date.now();

    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization, X-Correlation-Id');
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    if (rateLimiter) {
      const allowed = await rateLimiter.handle(req, res as any);
      if (!allowed) return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      buildHealthResponse(options).then((health) => {
        const httpStatus = health.status === 'error' ? 503 : 200;
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      }).catch((err) => {
        logger.error('Health check failed unexpectedly', { error: err, requestId, correlationId });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', detail: 'Internal health check failure' }));
      });
      return;
    }

    // GET /api/events
    if (req.method === 'GET' && url.pathname.startsWith('/api/events')) {
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const events =
        limit !== undefined && !Number.isNaN(limit)
          ? eventRegistry.getEvents(limit)
          : eventRegistry.getEvents();

      logger.info('Handling GET /api/events', { requestId, correlationId, limit: limit ?? 'all' });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: eventRegistry.count(), events }));

      logger.info('GET /api/events complete', {
        requestId,
        correlationId,
        returned: events.length,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // GET /api/rate-limit/metrics
    if (req.method === 'GET' && url.pathname === '/api/rate-limit/metrics') {
      if (!rateLimiter) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limiting not enabled' }));
        return;
      }

      const metrics = rateLimiter.getMetrics();
      const reset = url.searchParams.get('reset') === 'true';

      logger.info('Handling GET /api/rate-limit/metrics', {
        requestId,
        correlationId,
        totalRequests: metrics.totalRequests,
        blockedRequests: metrics.blockedRequests,
        reset,
        durationMs: Date.now() - startTime,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics));

      if (reset) {
        rateLimiter.resetMetrics();
        logger.info('Rate limit metrics reset after read', { requestId, correlationId });
      }
      return;
    }

    // GET /api/analytics
    if (req.method === 'GET' && url.pathname.startsWith('/api/analytics')) {
      const aggregator =
        options.analyticsAggregator !== undefined
          ? options.analyticsAggregator
          : getNotificationAnalyticsAggregator();

      if (!aggregator) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Analytics aggregator unavailable' }));
        return;
      }

      const snapshot = aggregator.snapshot();
      const reset = url.searchParams.get('reset') === 'true';

      logger.info('Handling GET /api/analytics', {
        requestId,
        correlationId,
        totalRecorded: snapshot.totalRecorded,
        reset,
        durationMs: Date.now() - startTime,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ...snapshot,
          ...(reset ? {} : {}),
        }),
      );

      if (reset) {
        aggregator.reset();
        logger.info('Analytics snapshot reset after read', { requestId, correlationId });
      }
      return;
    }

    // POST /api/webhooks
    if (req.method === 'POST' && url.pathname === '/api/webhooks') {
      collectRawBody(req).then((rawBody) => {
        const signatureHeader = extractSignature(req.headers);
        const keyId = extractKeyId(req.headers);

        if (!signatureHeader) {
          logger.warn('Webhook missing signature header', { requestId, correlationId });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing signature header' }));
          return;
        }

        if (!keyId) {
          logger.warn('Webhook missing key-id header', { requestId, correlationId });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing key-id header' }));
          return;
        }

        const secrets = options.webhookSecrets ?? [];
        const secret = getSecretForKey(secrets, keyId);

        if (!secret) {
          logger.warn('Webhook unknown key-id', { requestId, correlationId, keyId });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown key-id' }));
          return;
        }

        if (!verifySignature(rawBody, signatureHeader, secret)) {
          logger.warn('Webhook invalid signature', { requestId, correlationId, keyId });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }

        logger.info('Webhook received and verified', { requestId, correlationId, keyId });
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));
      }).catch((err) => {
        logger.error('Failed to read webhook body', { requestId, correlationId, error: err });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read request body' }));
      });
      return;
    }

    // POST /api/schedule
    if (req.method === 'POST' && url.pathname === '/api/schedule') {
      if (!options.notificationAPI) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduler not enabled' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);

          if (!data.executeAt || !data.payload || !data.targetRecipient) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required fields: executeAt, payload, targetRecipient' }));
            return;
          }

          const executeAt = new Date(data.executeAt);
          if (isNaN(executeAt.getTime())) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'executeAt is not a valid date' }));
            return;
          }

          const notificationId = await options.notificationAPI!.scheduleNotification({
            payload: data.payload,
            notificationType: data.notificationType || NotificationType.DISCORD,
            targetRecipient: data.targetRecipient,
            executeAt,
            maxRetries: data.maxRetries,
            priority: data.priority,
            eventId: data.eventId,
            contractAddress: data.contractAddress,
            metadata: data.metadata,
          });

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: notificationId }));

          logger.info('Notification scheduled via API', { requestId, correlationId, notificationId, executeAt: data.executeAt });
        } catch (error) {
          logger.error('Failed to schedule notification', { error, requestId, correlationId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
      return;
    }

    // GET /api/schedule/stats
    if (req.method === 'GET' && url.pathname === '/api/schedule/stats') {
      if (!options.notificationAPI) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduler not enabled' }));
        return;
      }

      options.notificationAPI.getStatistics()
        .then((stats) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
        })
        .catch((error) => {
          logger.error('Failed to get scheduler stats', { error, requestId, correlationId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    // GET /api/schedule/:id
    if (req.method === 'GET' && url.pathname.startsWith('/api/schedule/')) {
      if (!options.notificationAPI) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduler not enabled' }));
        return;
      }

      const id = parseInt(url.pathname.split('/').pop() || '', 10);
      if (isNaN(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid notification ID' }));
        return;
      }

      options.notificationAPI.getNotification(id)
        .then((notification) => {
          if (!notification) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Notification not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(notification));
        })
        .catch((error) => {
          logger.error('Failed to get notification', { error, requestId, correlationId, id });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    // Get notification delivery history endpoint
    if (req.method === 'GET' && req.url?.startsWith('/api/notifications/history')) {
      const url = new URL(req.url, 'http://localhost');
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
      const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;
      const status = url.searchParams.get('status') as 'SUCCESS' | 'FAILED' | 'RETRY' | null;
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      logger.info('Handling GET /api/notifications/history', {
        requestId,
        correlationId,
        limit,
        offset,
        status,
        startDate,
        endDate,
      });

      historyService.getHistory({
        limit,
        offset,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));

          logger.info('GET /api/notifications/history complete', {
            requestId,
            correlationId,
            returned: result.records.length,
            total: result.total,
            durationMs: Date.now() - startTime,
          });
        })
        .catch((error) => {
          logger.error('Failed to retrieve notification history', { error, requestId, correlationId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    logger.warn('Unhandled request', {
      requestId,
      method: req.method,
      url: req.url,
    });
    // GET /api/preferences/:userId
    const getPrefsMatch = url.pathname.match(/^\/api\/preferences\/([^/]+)$/);
    if (req.method === 'GET' && getPrefsMatch) {
      const userId = decodeURIComponent(getPrefsMatch[1]);
      logger.info('Handling GET /api/preferences/:userId', { requestId, correlationId, userId });
      const prefs = preferenceStore.get(userId);
      logger.info('GET /api/preferences/:userId complete', { requestId, correlationId, userId, durationMs: Date.now() - startTime });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(prefs));
      return;
    }

    // PUT /api/preferences/:userId
    const putPrefsMatch = url.pathname.match(/^\/api\/preferences\/([^/]+)$/);
    if (req.method === 'PUT' && putPrefsMatch) {
      const userId = decodeURIComponent(putPrefsMatch[1]);
      logger.info('Handling PUT /api/preferences/:userId', { requestId, correlationId, userId });
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const input: PreferencesUpdateInput = JSON.parse(body);
          if (!input || typeof input.categories !== 'object') {
            logger.warn('PUT /api/preferences/:userId invalid body', { requestId, correlationId, userId });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid body: expected { categories: { [key]: boolean } }' }));
            return;
          }
          const updated = preferenceStore.update(userId, input);
          logger.info('PUT /api/preferences/:userId complete', { requestId, correlationId, userId, durationMs: Date.now() - startTime });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch {
          logger.error('PUT /api/preferences/:userId invalid JSON', { requestId, correlationId, userId });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    logger.warn('Unhandled request', { requestId, correlationId, method: req.method, url: req.url });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
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