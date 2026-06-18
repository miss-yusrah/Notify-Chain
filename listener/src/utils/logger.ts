import winston from 'winston';

/**
 * Structured logger for the notification pipeline.
 *
 * All log entries include:
 *   - timestamp  – ISO 8601 timestamp
 *   - level      – log severity (info, warn, error, debug)
 *   - message    – human-readable description of the event
 *   - requestId  – (optional) identifier propagated through a poll/request cycle
 *   - durationMs – (optional) elapsed time for timed operations
 *
 * Set LOG_LEVEL env var to control verbosity (default: "info").
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                return `${timestamp} ${level}: ${message}${metaStr}`;
              })
            ),
    }),
  ],
});

export default logger;
