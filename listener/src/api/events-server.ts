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
import { SearchSuggestionService } from '../services/search-suggestion';
import {
  verifySignature,
  extractSignature,
  extractKeyId,
  getSecretForKey,
  collectRawBody,
} from '../services/webhook-verifier';
import { WebhookSecret, RateLimitConfig, ContractConfig } from '../types';
import { WebhookSecret, RateLimitConfig } from '../types';
import { RateLimiter } from './rate-limiter';
import {
  getNotificationAnalyticsAggregator,
  NotificationAnalyticsAggregator,
} from '../services/notification-analytics-aggregator';
import { NotificationTemplateService } from '../services/notification-template-service';
import {
  TemplateNotFoundError,
  TemplateValidationError,
} from '../services/notification-template-repository';
import {
  parseTemplateUpdateBody,
  resolveRequestActor,
  serializeAuditRecord,
  serializeTemplate,
} from './template-api';
import { CreateNotificationTemplateInput } from '../types/notification-template';
import { handleArchiveRequest } from './archive-api';
import { ArchiveStore } from '../services/archive-store';
import { ArchiveService } from '../services/archive-service';

export interface EventsServerOptions {
  port: number;
  corsOrigin?: string;
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  contractAddresses: ContractConfig[];
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
  templateService?: NotificationTemplateService | null;
  /** Archive store for retrieval endpoints (optional). */
  archiveStore?: ArchiveStore | null;
  /** Archive service for the admin /run endpoint (optional). */
  archiveService?: ArchiveService | null;
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
const NETWORK_TIP_CACHE_TTL_MS = 2000;

type IndexingStatus = 'synced' | 'syncing' | 'degraded';

interface IndexingHealthResponse {
  status: IndexingStatus;
  timestamp: string;
  indexedLedger: number | null;
  networkTipLedger: number | null;
  ledgerLag: number | null;
  /**
   * Time since the last event was ingested into the in-memory registry.
   * This serves as a lightweight proxy for ingestion latency / pipeline stalls.
   */
  processingDelayMs: number | null;
  lastIngestedAt: string | null;
  detail?: string;
}

let cachedNetworkTip:
  | { fetchedAt: number; ledger: number | null; errorDetail?: string }
  | null = null;

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

async function getContractPauseStatus(
  contractAddress: string,
  stellarRpcUrl: string
): Promise<{ paused: boolean; error?: string }> {
  try {
    const server = new StellarSDK.rpc.Server(stellarRpcUrl);
    const contract = new StellarSDK.Contract(contractAddress);
    
    // Create a dummy account for simulation (we don't need to actually sign anything)
    const dummyKeypair = StellarSDK.Keypair.random();
    const sourceAccount = await server.getAccount(dummyKeypair.publicKey()).catch(() => {
      // If the dummy account doesn't exist, we can still simulate
      return new StellarSDK.Account(dummyKeypair.publicKey(), '0');
    });

    const tx = new StellarSDK.TransactionBuilder(sourceAccount, {
      fee: StellarSDK.BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015', // We just need this for simulation
    })
      .addOperation(contract.call('get_paused_status'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (!StellarSDK.rpc.isSuccessfulSim(simulation) || !simulation.result) {
      return { 
        paused: false, 
        error: simulation.error ? simulation.error.message : 'Failed to simulate contract call' 
      };
    }

    const value = StellarSDK.scValToNative(simulation.result.retval);
    return { paused: !!value };
  } catch (err) {
    return { 
      paused: false, 
      error: err instanceof Error ? err.message : String(err) 
    };
  }
}

async function buildStatusResponse(options: EventsServerOptions): Promise<{
  contracts: Array<{
    address: string;
    paused: boolean;
    error?: string;
  }>;
  timestamp: string;
}> {
  const contractStatuses = await Promise.all(
    options.contractAddresses.map(async (contractConfig) => {
      const status = await getContractPauseStatus(contractConfig.address, options.stellarRpcUrl);
      return {
        address: contractConfig.address,
        ...status
      };
    })
  );

  return {
    timestamp: new Date().toISOString(),
    contracts: contractStatuses
async function fetchNetworkTipLedger(rpcUrl: string): Promise<{
  ledger: number | null;
  errorDetail?: string;
}> {
  if (
    cachedNetworkTip &&
    Date.now() - cachedNetworkTip.fetchedAt < NETWORK_TIP_CACHE_TTL_MS
  ) {
    return { ledger: cachedNetworkTip.ledger, errorDetail: cachedNetworkTip.errorDetail };
  }

  const start = Date.now();
  try {
    const server = new StellarSDK.rpc.Server(rpcUrl);

    // `getLatestLedger` is the most direct source of the current ledger/tip for Soroban RPC.
    // We keep extraction defensive to avoid hard-coupling to the SDK response shape.
    const latest: any = await withTimeout<any>(
      (server as any).getLatestLedger(),
      HEALTH_TIMEOUT_MS
    );
    const ledger =
      typeof latest?.sequence === 'number'
        ? latest.sequence
        : typeof latest?.ledger === 'number'
          ? latest.ledger
          : typeof latest?.latestLedger === 'number'
            ? latest.latestLedger
            : null;

    cachedNetworkTip = { fetchedAt: Date.now(), ledger };
    return { ledger };
  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    cachedNetworkTip = { fetchedAt: Date.now(), ledger: null, errorDetail };
    logger.warn('Failed to fetch network tip ledger', {
      rpcUrl,
      durationMs: Date.now() - start,
      errorDetail,
    });
    return { ledger: null, errorDetail };
  }
}

function deriveIndexingStatus(args: {
  indexedLedger: number | null;
  networkTipLedger: number | null;
  processingDelayMs: number | null;
}): { status: IndexingStatus; detail?: string } {
  const { indexedLedger, networkTipLedger, processingDelayMs } = args;

  if (networkTipLedger === null) {
    return { status: 'degraded', detail: 'Unable to resolve network tip ledger.' };
  }

  if (indexedLedger === null) {
    return { status: 'syncing', detail: 'No events ingested yet.' };
  }

  const ledgerLag = Math.max(0, networkTipLedger - indexedLedger);
  const delay = processingDelayMs ?? Number.POSITIVE_INFINITY;

  if (ledgerLag === 0 && delay <= 60_000) {
    return { status: 'synced' };
  }

  if (ledgerLag <= 5 && delay <= 5 * 60_000) {
    return { status: 'syncing', detail: `Behind by ${ledgerLag} ledger(s).` };
  }

  return {
    status: 'degraded',
    detail: `Behind by ${ledgerLag} ledger(s) and last ingestion was ${Math.round(
      delay / 1000
    )}s ago.`,
  };
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

function isRateLimitExempt(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api/rate-limit/metrics';
}

export function createEventsServer(options: EventsServerOptions): http.Server {
  const corsOrigin = options.corsOrigin ?? 'http://localhost:5173';
  const historyService = new NotificationHistoryService();
  const suggestionService = new SearchSuggestionService();
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

    const url = new URL(req.url ?? '/', 'http://localhost');

    // The rate-limit metrics endpoint is an observability route and must stay
    // reachable even after a client exhausts its quota — otherwise callers
    // can't read the very metrics that explain why they are being throttled.
    const isRateLimitExempt =
      req.method === 'GET' && url.pathname === '/api/rate-limit/metrics';

    if (rateLimiter && !isRateLimitExempt) {
      const allowed = await rateLimiter.handle(req, res as any);
      if (!allowed) return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

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

    // GET /api/status
    if (req.method === 'GET' && url.pathname === '/api/status') {
      buildStatusResponse(options).then((status) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      }).catch((err) => {
        logger.error('Status check failed unexpectedly', { error: err, requestId, correlationId });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', detail: 'Internal status check failure' }));
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

    // GET /api/indexing/health
    if (req.method === 'GET' && url.pathname === '/api/indexing/health') {
      const networkTip = await fetchNetworkTipLedger(options.stellarRpcUrl);
      const ingestion = eventRegistry.getIngestionSnapshot();

      const now = Date.now();
      const processingDelayMs =
        ingestion.lastIngestedAt === null ? null : Math.max(0, now - ingestion.lastIngestedAt);

      const indexedLedger = ingestion.lastIngestedLedger;
      const networkTipLedger = networkTip.ledger;
      const ledgerLag =
        indexedLedger === null || networkTipLedger === null
          ? null
          : Math.max(0, networkTipLedger - indexedLedger);

      const derived = deriveIndexingStatus({ indexedLedger, networkTipLedger, processingDelayMs });

      const response: IndexingHealthResponse = {
        status: derived.status,
        timestamp: new Date().toISOString(),
        indexedLedger,
        networkTipLedger,
        ledgerLag,
        processingDelayMs,
        lastIngestedAt: ingestion.lastIngestedAt ? new Date(ingestion.lastIngestedAt).toISOString() : null,
        detail: derived.detail ?? networkTip.errorDetail,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
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

    // GET /api/search/suggestions
    if (req.method === 'GET' && url.pathname === '/api/search/suggestions') {
      const q = url.searchParams.get('q') || '';
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;

      logger.info('Handling GET /api/search/suggestions', { requestId, correlationId, q, limit });

      suggestionService.getSuggestions(q, limit)
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));

          logger.info('GET /api/search/suggestions complete', {
            requestId,
            durationMs: Date.now() - startTime,
          });
        })
        .catch((error) => {
          logger.error('Failed to retrieve search suggestions', { error, requestId, correlationId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    // GET /api/templates/:id/audit
    const templateAuditMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/audit$/);
    if (req.method === 'GET' && templateAuditMatch) {
      if (!options.templateService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Template service not enabled' }));
        return;
      }

      const templateId = decodeURIComponent(templateAuditMatch[1]);
      logger.info('Handling GET /api/templates/:id/audit', { requestId, correlationId, templateId });

      options.templateService.getAuditHistory(templateId)
        .then(async (records) => {
          const template = await options.templateService!.getById(templateId);
          if (!template && records.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Template not found' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            templateId,
            records: records.map(serializeAuditRecord),
          }));
        })
        .catch((error) => {
          logger.error('Failed to load template audit history', { error, requestId, correlationId, templateId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    // GET /api/templates/:id
    const getTemplateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
    if (req.method === 'GET' && getTemplateMatch) {
      if (!options.templateService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Template service not enabled' }));
        return;
      }

      const templateId = decodeURIComponent(getTemplateMatch[1]);
      logger.info('Handling GET /api/templates/:id', { requestId, correlationId, templateId });

      options.templateService.getById(templateId)
        .then((template) => {
          if (!template) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Template not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(serializeTemplate(template)));
        })
        .catch((error) => {
          logger.error('Failed to load template', { error, requestId, correlationId, templateId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        });
      return;
    }

    // PUT /api/templates/:id
    if (req.method === 'PUT' && getTemplateMatch) {
      if (!options.templateService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Template service not enabled' }));
        return;
      }

      const templateId = decodeURIComponent(getTemplateMatch[1]);
      const actor = resolveRequestActor(req);
      logger.info('Handling PUT /api/templates/:id', { requestId, correlationId, templateId, actor });

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body) as unknown;
            const input = parseTemplateUpdateBody(parsed);
            const updated = await options.templateService!.update(templateId, input, actor);
            logger.info('PUT /api/templates/:id complete', {
              requestId,
              correlationId,
              templateId,
              actor,
              durationMs: Date.now() - startTime,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(serializeTemplate(updated)));
          } catch (error) {
            if (error instanceof SyntaxError) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }
            if (error instanceof TemplateNotFoundError) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
              return;
            }
            if (error instanceof TemplateValidationError || (error instanceof Error && error.message.startsWith('Invalid body'))) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: (error as Error).message }));
              return;
            }
            logger.error('Failed to update template', { error, requestId, correlationId, templateId, actor });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        })();
      });
      return;
    }

    // POST /api/templates
    if (req.method === 'POST' && url.pathname === '/api/templates') {
      if (!options.templateService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Template service not enabled' }));
        return;
      }

      logger.info('Handling POST /api/templates', { requestId, correlationId });
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body) as CreateNotificationTemplateInput;
            if (!parsed?.id || !parsed?.name || !parsed?.type || !parsed?.body) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Invalid body: id, name, type, and body are required',
              }));
              return;
            }

            const created = await options.templateService!.create(parsed);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(serializeTemplate(created)));
          } catch (error) {
            if (error instanceof SyntaxError) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }
            if (error instanceof TemplateValidationError) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
              return;
            }
            logger.error('Failed to create template', { error, requestId, correlationId });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        })();
      });
      return;
    }

    // GET /api/preferences/:userId
    const getPrefsMatch = url.pathname.match(/^\/api\/preferences\/([^/]+)$/);
    if (req.method === 'GET' && getPrefsMatch) {
      const userId = decodeURIComponent(getPrefsMatch[1]);
      logger.info('Handling GET /api/preferences/:userId', { requestId, correlationId, userId });
      const prefs = preferenceStore.get(userId);
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

    // GET /api/archive, GET /api/archive/:id, POST /api/archive/run
    if (options.archiveStore && (url.pathname === '/api/archive' || url.pathname.startsWith('/api/archive/'))) {
      const handled = await handleArchiveRequest(req, res, {
        store: options.archiveStore,
        service: options.archiveService,
      }, requestId);
      if (handled) return;
    }

    logger.warn('Unhandled request', {
      requestId,
      method: req.method,
      url: req.url,
    });
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
