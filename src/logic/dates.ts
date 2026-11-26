import type { DateKey } from './model';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of a moment, as YYYY-MM-DD. */
export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** True for a well-formed key naming a real calendar date. */
export function isDateKey(value: string): value is DateKey {
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

/**
 * Calendar arithmetic is done in UTC so it never depends on the device's
 * time zone or daylight-saving changes.
 */
function keyToUtcMs(key: DateKey): number {
  if (!isDateKey(key)) throw new Error(`Invalid date key: ${key}`);
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): DateKey {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key: DateKey, days: number): DateKey {
  return utcMsToKey(keyToUtcMs(key) + days * MS_PER_DAY);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((keyToUtcMs(b) - keyToUtcMs(a)) / MS_PER_DAY);
}

/** Day of week, 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: DateKey): number {
  return (new Date(keyToUtcMs(key)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing the given day. */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -weekdayIndex(key));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short date like "Wed, Nov 26" (adds the year when it differs from today's). */
export function formatShortDate(key: DateKey, today: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  const base = `${WEEKDAYS[weekdayIndex(key)]}, ${MONTHS[m - 1]} ${d}`;
  return y === Number(today.slice(0, 4)) ? base : `${base}, ${y}`;
}

/** "Today", "Yesterday", or a short date. */
export function relativeDayLabel(key: DateKey, today: DateKey): string {
  const diff = daysBetween(key, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return formatShortDate(key, today);
}
