import http from 'http';
import { eventRegistry } from '../store/event-registry';
import logger from '../utils/logger';
import { generateRequestId } from '../utils/request-id';

export interface EventsServerOptions {
  port: number;
  corsOrigin?: string;
}

export function createEventsServer(options: EventsServerOptions): http.Server {
  const corsOrigin = options.corsOrigin ?? 'http://localhost:5173';

  return http.createServer((req, res) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Request-Id', requestId);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/events')) {
      const url = new URL(req.url, 'http://localhost');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;

      logger.info('Handling GET /api/events', {
        requestId,
        limit: limit ?? 'all',
      });

      const events =
        limit !== undefined && !Number.isNaN(limit)
          ? eventRegistry.getEvents(limit)
          : eventRegistry.getEvents();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          count: eventRegistry.count(),
          events,
        })
      );

      logger.info('GET /api/events complete', {
        requestId,
        returned: events.length,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    logger.warn('Unhandled request', {
      requestId,
      method: req.method,
      url: req.url,
    });

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

export function startEventsServer(options: EventsServerOptions): http.Server {
  const server = createEventsServer(options);
  server.listen(options.port, () => {
    logger.info('Events API server listening', { port: options.port });
  });
  return server;
}
