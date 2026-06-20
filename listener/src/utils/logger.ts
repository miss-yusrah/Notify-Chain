import winston from 'winston';

export interface FormattedError {
  message: string;
  name: string;
  stack?: string;
  cause?: FormattedError | string;
}

/**
 * Normalize unknown thrown values into a structured object for logging.
 */
export function formatError(error: unknown): FormattedError | string {
  if (error instanceof Error) {
    const formatted: FormattedError = {
      message: error.message,
      name: error.name,
    };

    if (error.stack) {
      formatted.stack = error.stack;
    }

    if ('cause' in error && error.cause !== undefined) {
      formatted.cause = formatError(error.cause);
    }

    return formatted;
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function formatMeta(meta: Record<string, unknown>): Record<string, unknown> {
  if (!('error' in meta) || meta.error === undefined) {
    return meta;
  }

  return {
    ...meta,
    error: formatError(meta.error),
  };
}

function logWithMeta(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>
): void {
  if (meta && Object.keys(meta).length > 0) {
    baseLogger[level](message, formatMeta(meta));
  } else {
    baseLogger[level](message);
  }
}

/**
 * Structured logger for the notification pipeline.
 *
 * All log entries include:
 *   - timestamp  – ISO 8601 timestamp
 *   - level      – log severity (debug, info, warn, error)
 *   - message    – human-readable description of the event
 *   - requestId  – (optional) identifier propagated through a poll/request cycle
 *   - durationMs – (optional) elapsed time for timed operations
 *
 * Set LOG_LEVEL env var to control verbosity (default: "info").
 */
const baseLogger = winston.createLogger({
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

const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => logWithMeta('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => logWithMeta('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => logWithMeta('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => logWithMeta('error', message, meta),
};

export default logger;
