import { formatTimestamp, formatTimestampShort } from './formatTime';

// 2024-01-15 14:30:45 UTC
const FIXED_TIMESTAMP = 1705329045000;

describe('formatTimestamp', () => {
  it('returns a non-empty string for a valid timestamp', () => {
    expect(typeof formatTimestamp(FIXED_TIMESTAMP)).toBe('string');
    expect(formatTimestamp(FIXED_TIMESTAMP).length).toBeGreaterThan(0);
  });

  it('includes a timezone abbreviation in the output', () => {
    const result = formatTimestamp(FIXED_TIMESTAMP);
    // Intl.DateTimeFormat with timeZoneName:'short' always appends a timezone token
    // (e.g. "UTC", "EST", "GMT+5") — check a broad pattern
    expect(result).toMatch(/[A-Z]{2,5}[+-]?\d*|UTC/);
  });

  it('includes the year in the output', () => {
    expect(formatTimestamp(FIXED_TIMESTAMP)).toContain('2024');
  });

  it('produces different output for different timestamps', () => {
    const earlier = formatTimestamp(FIXED_TIMESTAMP - 60000);
    const later = formatTimestamp(FIXED_TIMESTAMP);
    expect(earlier).not.toBe(later);
  });

  it('handles the Unix epoch without throwing', () => {
    expect(() => formatTimestamp(0)).not.toThrow();
  });

  it('handles large future timestamps without throwing', () => {
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    expect(() => formatTimestamp(farFuture)).not.toThrow();
  });
});

describe('formatTimestampShort', () => {
  it('returns a non-empty string for a valid timestamp', () => {
    expect(typeof formatTimestampShort(FIXED_TIMESTAMP)).toBe('string');
    expect(formatTimestampShort(FIXED_TIMESTAMP).length).toBeGreaterThan(0);
  });

  it('includes a timezone abbreviation in the output', () => {
    const result = formatTimestampShort(FIXED_TIMESTAMP);
    expect(result).toMatch(/[A-Z]{2,5}[+-]?\d*|UTC/);
  });

  it('is shorter than or equal to the full timestamp for the same input', () => {
    const full = formatTimestamp(FIXED_TIMESTAMP);
    const short = formatTimestampShort(FIXED_TIMESTAMP);
    expect(short.length).toBeLessThanOrEqual(full.length);
  });

  it('produces different output for different timestamps', () => {
    const earlier = formatTimestampShort(FIXED_TIMESTAMP - 3600000);
    const later = formatTimestampShort(FIXED_TIMESTAMP);
    expect(earlier).not.toBe(later);
  });

  it('handles the Unix epoch without throwing', () => {
    expect(() => formatTimestampShort(0)).not.toThrow();
  });
});
