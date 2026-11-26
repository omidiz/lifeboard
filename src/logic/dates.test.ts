import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatShortDate,
  isDateKey,
  relativeDayLabel,
  startOfWeek,
  toDateKey,
  weekdayIndex,
} from './dates';

describe('toDateKey', () => {
  it('uses the local calendar date with zero padding', () => {
    expect(toDateKey(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05');
  });

  it('keeps late-evening moments on the same local day', () => {
    expect(toDateKey(new Date(2026, 10, 26, 23, 59))).toBe('2026-11-26');
    expect(toDateKey(new Date(2026, 10, 27, 0, 1))).toBe('2026-11-27');
  });
});

describe('isDateKey', () => {
  it('accepts real dates', () => {
    expect(isDateKey('2026-11-26')).toBe(true);
    expect(isDateKey('2024-02-29')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isDateKey('2026-11-6')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-04-31')).toBe(false);
    expect(isDateKey('nope')).toBe(false);
  });
});

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-11-26', 1)).toBe('2026-11-27');
    expect(addDays('2026-11-26', -1)).toBe('2026-11-25');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('is unaffected by daylight-saving changes', () => {
    // EU and US clock changes in 2026.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('rejects invalid keys', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
});

describe('daysBetween', () => {
  it('counts whole days in either direction', () => {
    expect(daysBetween('2026-11-20', '2026-11-26')).toBe(6);
    expect(daysBetween('2026-11-26', '2026-11-20')).toBe(-6);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('weeks', () => {
  it('treats Monday as the first day of the week', () => {
    expect(weekdayIndex('2026-11-23')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-29')).toBe(6); // Sunday
  });

  it('finds the Monday of the week', () => {
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-23')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });
});

describe('labels', () => {
  const today = '2026-11-26';

  it('names today and yesterday', () => {
    expect(relativeDayLabel('2026-11-26', today)).toBe('Today');
    expect(relativeDayLabel('2026-11-25', today)).toBe('Yesterday');
  });

  it('uses a short date for older days', () => {
    expect(relativeDayLabel('2026-11-23', today)).toBe('Mon, Nov 23');
  });

  it('adds the year for other years', () => {
    expect(formatShortDate('2025-12-31', today)).toBe('Wed, Dec 31, 2025');
  });
});
