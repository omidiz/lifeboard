import type { CheckIn, DateKey, DayRecord, TimeOfDay } from './model';

export const DEFAULT_BEDTIME: TimeOfDay = '23:00';
export const DEFAULT_WAKE_TIME: TimeOfDay = '07:00';

export function emptyDay(date: DateKey, now: string): DayRecord {
  return {
    date,
    checkIn: null,
    habitTicks: [],
    focusSessions: [],
    note: '',
    noteUpdatedAt: null,
    updatedAt: now,
  };
}

export interface CheckInDefaults {
  bedtime: TimeOfDay;
  wakeTime: TimeOfDay;
  /** True when the times come from an earlier day's check-in. */
  fromPrevious: boolean;
}

/** Times to suggest for a new check-in: the most recent earlier check-in, else sensible defaults. */
export function checkInDefaults(previous: CheckIn | null | undefined): CheckInDefaults {
  if (previous) {
    return { bedtime: previous.bedtime, wakeTime: previous.wakeTime, fromPrevious: true };
  }
  return { bedtime: DEFAULT_BEDTIME, wakeTime: DEFAULT_WAKE_TIME, fromPrevious: false };
}

export type CheckInPatch = Partial<Omit<CheckIn, 'updatedAt'>>;

/**
 * Applies a change to the day's check-in. If the day has no check-in yet,
 * it starts from the suggested defaults, so accepting a prefilled time is
 * as simple as answering any other question.
 */
export function applyCheckIn(
  day: DayRecord,
  patch: CheckInPatch,
  defaults: CheckInDefaults,
  now: string,
): DayRecord {
  const base: CheckIn = day.checkIn ?? {
    bedtime: defaults.bedtime,
    wakeTime: defaults.wakeTime,
    sleepQuality: null,
    energy: null,
    mood: null,
    updatedAt: now,
  };
  return { ...day, checkIn: { ...base, ...patch, updatedAt: now }, updatedAt: now };
}

export const NOTE_MAX_LENGTH = 200;

/** Keeps the note to one line of at most NOTE_MAX_LENGTH characters. */
export function normalizeNote(note: string): string {
  return note.replace(/[\r\n]+/g, ' ').slice(0, NOTE_MAX_LENGTH);
}

export function applyNote(day: DayRecord, note: string, now: string): DayRecord {
  const clean = normalizeNote(note);
  if (clean === day.note) return day;
  return { ...day, note: clean, noteUpdatedAt: now, updatedAt: now };
}

/** Ticks or unticks a habit on this day. */
export function toggleHabitTick(day: DayRecord, habitId: string, now: string): DayRecord {
  const ticked = day.habitTicks.includes(habitId);
  const habitTicks = ticked ? day.habitTicks.filter((id) => id !== habitId) : [...day.habitTicks, habitId];
  return { ...day, habitTicks, updatedAt: now };
}
