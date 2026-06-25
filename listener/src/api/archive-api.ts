/**
 * Archive API route handler.
 *
 * Mounted into events-server.ts and handles:
 *   GET  /api/archive              – paginated list of archived notifications
 *   GET  /api/archive/:id          – single archived record by archive PK
 *   POST /api/archive/run          – trigger an on-demand archive cycle (admin)
 *
 * All endpoints return JSON.  The optional `archiveService` parameter is only
 * needed for the admin /run endpoint; read-only endpoints only require `store`.
 */
import http from 'http';
import { ArchiveStore } from '../services/archive-store';
import { ArchiveService } from '../services/archive-service';
import logger from '../utils/logger';

export interface ArchiveApiHandlerDeps {
  store: ArchiveStore;
  service?: ArchiveService | null;
}

/**
 * Try to handle an archive API request.
 * Returns `true` if the request was handled (so the caller can `return`),
 * `false` if it was not an archive route.
 */
export async function handleArchiveRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ArchiveApiHandlerDeps,
  requestId: string,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;

  // POST /api/archive/run  – trigger on-demand cycle
  if (req.method === 'POST' && pathname === '/api/archive/run') {
    if (!deps.service) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Archive service not enabled' }));
      return true;
    }
    logger.info('Handling POST /api/archive/run', { requestId });
    try {
      const result = await deps.service.runCycle();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      logger.error('Archive run failed', { error: err, requestId });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // GET /api/archive/:id
  const singleMatch = pathname.match(/^\/api\/archive\/(\d+)$/);
  if (req.method === 'GET' && singleMatch) {
    const id = parseInt(singleMatch[1], 10);
    logger.info('Handling GET /api/archive/:id', { requestId, id });
    try {
      const record = await deps.store.getById(id);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Archived record not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record));
    } catch (err) {
      logger.error('Failed to fetch archive record', { error: err, requestId, id });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // GET /api/archive
  if (req.method === 'GET' && pathname === '/api/archive') {
    logger.info('Handling GET /api/archive', { requestId });
    try {
      const options = {
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined,
        status: url.searchParams.get('status') ?? undefined,
        contractAddress: url.searchParams.get('contractAddress') ?? undefined,
        startDate: url.searchParams.get('startDate') ?? undefined,
        endDate: url.searchParams.get('endDate') ?? undefined,
      };
      const result = await deps.store.query(options);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      logger.error('Failed to query archive', { error: err, requestId });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  return false;
}
