import http from 'http';

/**
 * Derives an accountable actor identifier from request auth headers or client IP.
 * Used for audit trails on admin mutations (e.g. template updates).
 */
export function resolveRequestActor(req: http.IncomingMessage): string {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return `api-key:${apiKeyHeader.trim()}`;
  }

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return `bearer:${token}`;
    }
  }

  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    const clientIp = xForwardedFor.split(',')[0].trim();
    if (clientIp) {
      return `ip:${clientIp}`;
    }
  }

  const remoteIp = req.socket.remoteAddress || 'unknown';
  return `ip:${remoteIp}`;
}
