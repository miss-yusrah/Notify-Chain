/**
 * Centralized timestamp formatting utilities.
 *
 * All functions accept a Unix millisecond timestamp and return a locale-aware
 * string in the browser's local timezone. The timezone abbreviation is always
 * included so users can see which timezone is being displayed, preventing
 * ambiguity across different locales and regions.
 */

const FULL_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
};

const SHORT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
};

/**
 * Formats a timestamp as a full date + time string with timezone abbreviation.
 * Example: "Jan 15, 2024, 02:30:45 PM EST"
 */
export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, FULL_OPTIONS).format(new Date(timestamp));
}

/**
 * Formats a timestamp as a short time-only string with timezone abbreviation.
 * Example: "02:30:45 PM EST"
 */
export function formatTimestampShort(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, SHORT_OPTIONS).format(new Date(timestamp));
}
