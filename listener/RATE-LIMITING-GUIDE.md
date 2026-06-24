# Rate Limiting Guide

## Overview

The Notify-Chain listener service includes a comprehensive rate limiting system to protect backend services from abuse while ensuring legitimate requests remain unaffected. This guide covers configuration, monitoring, and best practices.

## Features

- ✅ **Configurable rate limits**: Set global and per-client request limits
- ✅ **Multiple client identification methods**: API keys, Bearer tokens, and IP addresses
- ✅ **Per-user/client overrides**: Custom limits for specific clients
- ✅ **Standard HTTP headers**: `X-RateLimit-*` and `Retry-After` headers
- ✅ **Meaningful error responses**: Clear 429 responses with retry information
- ✅ **Comprehensive monitoring**: Real-time metrics and database logging
- ✅ **Security-focused**: API key masking in logs and metrics

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
# Enable or disable rate limiting
RATE_LIMIT_ENABLED=true

# Time window in milliseconds (default: 60000 = 1 minute)
RATE_LIMIT_WINDOW_MS=60000

# Maximum requests per window (default: 60)
RATE_LIMIT_MAX_REQUESTS=60

# Per-client overrides (JSON format)
RATE_LIMIT_CLIENT_OVERRIDES={"vip-api-key":{"maxRequests":1000,"windowMs":60000},"192.168.1.100":{"maxRequests":10}}
```

### Client Overrides

You can configure custom rate limits for specific clients using the `RATE_LIMIT_CLIENT_OVERRIDES` environment variable. This is useful for:

- **VIP clients**: Higher limits for premium users
- **Known abusers**: Lower limits for problematic clients
- **Internal services**: Different limits for internal vs external traffic

**Example configuration:**

```json
{
  "premium-api-key-123": {
    "maxRequests": 1000,
    "windowMs": 60000
  },
  "suspicious-ip": {
    "maxRequests": 10,
    "windowMs": 60000
  },
  "192.168.1.50": {
    "maxRequests": 500
  }
}
```

**Note:** If `windowMs` is omitted for a client override, the global `RATE_LIMIT_WINDOW_MS` is used.

## Client Identification

The rate limiter identifies clients using the following priority:

1. **`x-api-key` header**: Custom API key header
   ```bash
   curl -H "x-api-key: your-api-key" http://localhost:8787/api/events
   ```

2. **`Authorization` Bearer token**: Standard OAuth/JWT bearer token
   ```bash
   curl -H "Authorization: Bearer your-token" http://localhost:8787/api/events
   ```

3. **`x-forwarded-for` header**: First IP in the chain (for proxied requests)

4. **Socket remote address**: Direct connection IP address (fallback)

## HTTP Response Headers

### Standard Rate Limit Headers

All responses include these headers when rate limiting is enabled:

- **`X-RateLimit-Limit`**: Maximum requests allowed in the window
- **`X-RateLimit-Remaining`**: Requests remaining in current window
- **`X-RateLimit-Reset`**: Unix timestamp when the limit resets

**Example:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1672531260
```

### Rate Limit Exceeded Response

When a client exceeds the rate limit, they receive:

- **HTTP Status**: `429 Too Many Requests`
- **`Retry-After` header**: Seconds to wait before retrying
- **JSON body** with error details

**Example response:**
```json
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1672531260
Retry-After: 45
Content-Type: application/json

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 45 seconds."
}
```

## Monitoring & Metrics

### Real-time Metrics Endpoint

Fetch current rate limiting statistics:

```bash
GET /api/rate-limit/metrics
```

**Response:**
```json
{
  "totalRequests": 1543,
  "blockedRequests": 87,
  "allowedRequests": 1456,
  "uniqueClients": 23,
  "topBlockedClients": [
    {
      "clientId": "192.168.1.100",
      "blockCount": 45
    },
    {
      "clientId": "sk_live_...",
      "blockCount": 23
    }
  ],
  "startTime": "2024-01-01T12:00:00.000Z"
}
```

### Reset Metrics

To reset metrics after reading (useful for periodic monitoring):

```bash
GET /api/rate-limit/metrics?reset=true
```

### Database Logging

All rate limit violations are logged to the `rate_limit_events` table:

```sql
SELECT * FROM rate_limit_events 
WHERE timestamp > datetime('now', '-1 hour')
ORDER BY timestamp DESC;
```

**Schema:**
- `client_id`: Full identifier (IP or API key)
- `client_type`: Either `'IP'` or `'API_KEY'`
- `endpoint`: Request path
- `method`: HTTP method
- `timestamp`: When the violation occurred
- `limit_threshold`: Limit that was exceeded
- `window_ms`: Time window in milliseconds

### Application Logs

Rate limit events are also logged via Winston with the following structure:

```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "requestId": "req_abc123",
  "clientId": "sk_live_...",
  "clientType": "API_KEY",
  "endpoint": "/api/schedule",
  "method": "POST",
  "limit": 60,
  "windowMs": 60000
}
```

## Security Features

### API Key Masking

API keys are automatically masked in logs and metrics to prevent exposure:

- Keys longer than 8 characters: `sk_live_very_long_key` → `sk_live_...`
- Keys 8 characters or shorter: `shortkey` → `***`
- IP addresses are NOT masked

### Request ID Correlation

Every request receives a unique `X-Request-Id` header for tracking and debugging. This ID is included in all logs and can be used to correlate rate limit events with specific requests.

## Usage Examples

### Basic Setup

1. **Enable rate limiting** in `.env`:
   ```env
   RATE_LIMIT_ENABLED=true
   RATE_LIMIT_MAX_REQUESTS=60
   RATE_LIMIT_WINDOW_MS=60000
   ```

2. **Start the service**:
   ```bash
   npm run dev
   ```

3. **Test the rate limit**:
   ```bash
   # Make multiple requests
   for i in {1..65}; do
     curl http://localhost:8787/api/events
   done
   ```

### Client with API Key

```bash
# Set API key
API_KEY="sk_live_your_api_key"

# Make authenticated request
curl -H "x-api-key: $API_KEY" http://localhost:8787/api/events
```

### Monitor Rate Limits

```bash
# Check current metrics
curl http://localhost:8787/api/rate-limit/metrics | jq

# Query database for violations
sqlite3 ./data/notifications.db "SELECT * FROM rate_limit_events ORDER BY timestamp DESC LIMIT 10"
```

### Disable Rate Limiting

```env
RATE_LIMIT_ENABLED=false
```

Or temporarily in code:
```typescript
const server = startEventsServer({
  port: 8787,
  stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
  rateLimit: {
    enabled: false,
    windowMs: 60000,
    maxRequests: 60,
    clientOverrides: {},
  },
});
```

## Best Practices

### 1. Set Appropriate Limits

- **Too restrictive**: Legitimate users will be blocked
- **Too permissive**: Abusers can still cause problems
- **Recommended starting point**: 60 requests per minute (1 per second average)

### 2. Use Client Overrides Wisely

- Identify VIP clients and give them higher limits
- Monitor metrics to identify abusive clients
- Apply stricter limits to known problematic IPs

### 3. Monitor Regularly

- Check `/api/rate-limit/metrics` periodically
- Set up alerts for high `blockedRequests` values
- Review database logs for patterns

### 4. Communicate Limits to API Consumers

- Document rate limits in API documentation
- Include rate limit headers in all responses
- Provide clear error messages

### 5. Test Thoroughly

- Test with different client identification methods
- Verify overrides work as expected
- Ensure metrics are accurate

## Testing

The rate limiter includes comprehensive tests covering:

- ✅ Client identification (API key, Bearer token, IP)
- ✅ Request limits (allowed/blocked scenarios)
- ✅ Per-client overrides
- ✅ Metrics tracking
- ✅ Database logging
- ✅ HTTP integration

**Run tests:**
```bash
npm test -- rate-limiter
```

## Troubleshooting

### Rate limits not working

1. Check `RATE_LIMIT_ENABLED` is set to `true`
2. Verify the configuration is loaded (check startup logs)
3. Ensure the database is initialized

### Clients not identified correctly

1. Check the client identification method (API key, IP, etc.)
2. Verify headers are being sent correctly
3. Check logs for the `clientId` and `clientType` values

### Metrics showing unexpected values

1. Metrics are reset when the service restarts
2. Use `?reset=true` to reset metrics manually
3. Check the database for historical data

### Rate limit overrides not applied

1. Verify JSON syntax in `RATE_LIMIT_CLIENT_OVERRIDES`
2. Check that client IDs match exactly (case-sensitive)
3. Restart the service after configuration changes

## API Reference

### RateLimiter Class

```typescript
class RateLimiter {
  constructor(config: RateLimitConfig);
  
  // Main middleware method
  async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    requestId?: string
  ): Promise<boolean>;
  
  // Get current metrics
  getMetrics(): RateLimitMetrics;
  
  // Reset metrics
  resetMetrics(): void;
  
  // Cleanup resources
  destroy(): void;
}
```

### Configuration Types

```typescript
interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  clientOverrides: Record<string, { 
    maxRequests: number; 
    windowMs?: number 
  }>;
}

interface RateLimitMetrics {
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  uniqueClients: number;
  topBlockedClients: Array<{ 
    clientId: string; 
    blockCount: number 
  }>;
  startTime: string;
}
```

## Performance Considerations

- **Memory usage**: In-memory cache stores timestamps for each client. Automatic cleanup runs every 5 minutes.
- **Database writes**: Rate limit violations are logged asynchronously to avoid blocking requests.
- **Overhead**: Rate limiting adds minimal latency (~1-2ms per request).

## Future Enhancements

Potential improvements for future versions:

- [ ] Distributed rate limiting (Redis-backed)
- [ ] Dynamic rate limit adjustment based on system load
- [ ] Rate limit by endpoint/route
- [ ] Sliding window algorithm option
- [ ] Webhook notifications for rate limit events
- [ ] Admin API for managing client overrides

## Support

For issues or questions:
- Check the [main README](./README.md)
- Review the [API documentation](./API.md)
- Open an issue on GitHub
