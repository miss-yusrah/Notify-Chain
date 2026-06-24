import http from 'http';
import logger from '../utils/logger';
import { getDatabase } from '../database/database';
import { RateLimitConfig } from '../types';

export interface RateLimitMetrics {
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  uniqueClients: number;
  topBlockedClients: Array<{ clientId: string; blockCount: number }>;
  startTime: string;
}

export class RateLimiter {
  // In-memory cache for client request timestamps: clientId -> timestampMs[]
  private cache = new Map<string, number[]>();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Metrics tracking
  private metrics = {
    totalRequests: 0,
    blockedRequests: 0,
    allowedRequests: 0,
    clientBlockCounts: new Map<string, number>(),
    startTime: new Date().toISOString(),
  };

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Periodically clean up stale cache entries to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
    // Ensure timer doesn't prevent process from exiting in tests/shutdown
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [clientId, timestamps] of this.cache.entries()) {
      const windowMs = this.getClientWindowMs(clientId);
      const validTimestamps = timestamps.filter(t => now - t < windowMs);
      if (validTimestamps.length === 0) {
        this.cache.delete(clientId);
      } else {
        this.cache.set(clientId, validTimestamps);
      }
    }
  }

  private getClientWindowMs(clientId: string): number {
    const override = this.config.clientOverrides[clientId];
    return override?.windowMs ?? this.config.windowMs;
  }

  private getClientMaxRequests(clientId: string): number {
    const override = this.config.clientOverrides[clientId];
    return override?.maxRequests ?? this.config.maxRequests;
  }

  /**
   * Identifies the client from the request.
   * Returns { clientId, clientType }
   */
  public identifyClient(req: http.IncomingMessage): { clientId: string; clientType: 'API_KEY' | 'IP' } {
    // 1. Check x-api-key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
      return { clientId: apiKeyHeader.trim(), clientType: 'API_KEY' };
    }

    // 2. Check Authorization header (Bearer token)
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        return { clientId: token, clientType: 'API_KEY' };
      }
    }

    // 3. Fallback to IP address
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
      const ips = xForwardedFor.split(',');
      const clientIp = ips[0].trim();
      if (clientIp) {
        return { clientId: clientIp, clientType: 'IP' };
      }
    }

    const remoteIp = req.socket.remoteAddress || '127.0.0.1';
    return { clientId: remoteIp, clientType: 'IP' };
  }

  /**
   * Main middleware check.
   * Checks if request should be rate limited.
   * Sets appropriate rate limiting headers on the response.
   * Returns true if allowed, false if blocked (in which case, it responds to the client).
   */
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    requestId?: string
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    this.metrics.totalRequests++;

    const { clientId, clientType } = this.identifyClient(req);
    const now = Date.now();
    const windowMs = this.getClientWindowMs(clientId);
    const maxRequests = this.getClientMaxRequests(clientId);

    // Get current requests and filter out expired timestamps
    const timestamps = this.cache.get(clientId) ?? [];
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    const isLimitExceeded = validTimestamps.length >= maxRequests;

    // Standard headers
    const remaining = Math.max(0, maxRequests - validTimestamps.length - (isLimitExceeded ? 0 : 1));
    const oldestTimestamp = validTimestamps[0] ?? now;
    const resetTimeSec = Math.ceil((oldestTimestamp + windowMs) / 1000);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetTimeSec));

    if (isLimitExceeded) {
      this.metrics.blockedRequests++;
      
      // Track blocks per client
      const currentBlockCount = this.metrics.clientBlockCounts.get(clientId) || 0;
      this.metrics.clientBlockCounts.set(clientId, currentBlockCount + 1);

      const waitMs = oldestTimestamp + windowMs - now;
      const waitSec = Math.ceil(waitMs / 1000);
      res.setHeader('Retry-After', String(waitSec));

      // Record rate limit event
      this.recordEvent(clientId, clientType, req.url || '', req.method || '', maxRequests, windowMs, requestId);

      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${waitSec} seconds.`,
        })
      );
      return false;
    }

    this.metrics.allowedRequests++;

    // Add current request timestamp
    validTimestamps.push(now);
    this.cache.set(clientId, validTimestamps);
    return true;
  }

  private recordEvent(
    clientId: string,
    clientType: 'API_KEY' | 'IP',
    endpoint: string,
    method: string,
    limitThreshold: number,
    windowMs: number,
    requestId?: string
  ): void {
    const maskedId = clientType === 'API_KEY'
      ? (clientId.length > 8 ? `${clientId.slice(0, 8)}...` : '***')
      : clientId;

    logger.warn('Rate limit exceeded', {
      requestId,
      clientId: maskedId,
      clientType,
      endpoint,
      method,
      limit: limitThreshold,
      windowMs,
    });

    const db = getDatabase();
    if (db.isConnected()) {
      db.run(
        `INSERT INTO rate_limit_events (client_id, client_type, endpoint, method, limit_threshold, window_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, clientType, endpoint, method, limitThreshold, windowMs]
      ).catch((err) => {
        logger.error('Failed to log rate limit event to database', { error: err });
      });
    }
  }

  // Helper for tests to inspect cache size
  public getCacheSize(): number {
    return this.cache.size;
  }

  // Helper for tests to clear cache
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get current rate limiting metrics
   */
  public getMetrics(): RateLimitMetrics {
    const topBlockedClients = Array.from(this.metrics.clientBlockCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([clientId, blockCount]) => {
        // Mask API keys for security
        const maskedId = clientId.includes('.')
          ? clientId // IP address - show as-is
          : clientId.length > 8
          ? `${clientId.slice(0, 8)}...`
          : '***';
        
        return { clientId: maskedId, blockCount };
      });

    return {
      totalRequests: this.metrics.totalRequests,
      blockedRequests: this.metrics.blockedRequests,
      allowedRequests: this.metrics.allowedRequests,
      uniqueClients: this.cache.size,
      topBlockedClients,
      startTime: this.metrics.startTime,
    };
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  public resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      allowedRequests: 0,
      clientBlockCounts: new Map<string, number>(),
      startTime: new Date().toISOString(),
    };
  }
}
