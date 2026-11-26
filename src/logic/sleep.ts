import type { TimeOfDay } from './model';

export const MINUTES_PER_DAY = 1440;
export const TIME_STEP_MINUTES = 15;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string): value is TimeOfDay {
  return TIME_RE.test(value);
}

/** "HH:MM" -> minutes since midnight. */
export function timeToMinutes(time: TimeOfDay): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight (any integer, wraps around the day) -> "HH:MM". */
export function minutesToTime(minutes: number): TimeOfDay {
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Moves a time by delta minutes, wrapping past midnight. Off-grid times
 * (e.g. 23:07) snap to the 15-minute grid in the direction of travel.
 */
export function shiftTime(time: TimeOfDay, delta: number, step = TIME_STEP_MINUTES): TimeOfDay {
  const current = timeToMinutes(time);
  if (current % step !== 0 && Math.abs(delta) === step) {
    const snapped = delta > 0 ? Math.ceil(current / step) * step : Math.floor(current / step) * step;
    return minutesToTime(snapped);
  }
  return minutesToTime(current + delta);
}

/**
 * Minutes slept between bedtime and wake time. Wake time is always taken
 * to be after bedtime, so a bedtime of 23:30 and a wake time of 07:00 is
 * 7h 30m across midnight. Equal times count as zero.
 */
export function sleepDurationMinutes(bedtime: TimeOfDay, wakeTime: TimeOfDay): number {
  const diff = timeToMinutes(wakeTime) - timeToMinutes(bedtime);
  return ((diff % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 465 -> "7h 45m", 480 -> "8h", 30 -> "30m". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
