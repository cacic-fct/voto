import { describe, expect, it } from 'vitest';
import { combineDateAndTime, formatDateOnly, parseDateOnly } from './date-only';

describe('date-only utilities', () => {
  it('round-trips calendar dates without a UTC conversion', () => {
    const date = parseDateOnly('2026-06-24');

    expect(date).not.toBeNull();
    expect(formatDateOnly(date)).toBe('2026-06-24');
  });

  it('rejects malformed and impossible calendar dates', () => {
    expect(parseDateOnly('24/06/2026')).toBeNull();
    expect(parseDateOnly('2026-02-29')).toBeNull();
  });

  it('parses valid local schedule times with date-fns', () => {
    expect(combineDateAndTime(new Date(2026, 5, 24), '08:30')).toBe(
      new Date(2026, 5, 24, 8, 30).toISOString(),
    );
    expect(combineDateAndTime(new Date(2026, 5, 24), '24:00')).toBeNull();
  });
});
