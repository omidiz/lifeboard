import { isPlainObject, uniqueById } from './json';
import type { CheckIn, DateKey, DayRecord, FocusSession, Rating, TimeOfDay } from './model';
import { isTimeOfDay } from './sleep';

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

// ---------- Reading stored or synced data ----------

const isIso = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function normalizeRating(value: unknown): Rating | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? (value as Rating) : null;
}

function normalizeCheckIn(raw: unknown, now: string): CheckIn | null {
  if (!isPlainObject(raw)) return null;
  const bedtime = typeof raw.bedtime === 'string' && isTimeOfDay(raw.bedtime) ? raw.bedtime : DEFAULT_BEDTIME;
  const wakeTime = typeof raw.wakeTime === 'string' && isTimeOfDay(raw.wakeTime) ? raw.wakeTime : DEFAULT_WAKE_TIME;
  return {
    bedtime,
    wakeTime,
    sleepQuality: normalizeRating(raw.sleepQuality),
    energy: normalizeRating(raw.energy),
    mood: normalizeRating(raw.mood),
    updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : now,
  };
}

function normalizeSession(raw: unknown): FocusSession | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (!isIso(raw.start) || !isIso(raw.end)) return null;
  const minutes = typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) ? Math.max(0, raw.minutes) : 0;
  return {
    id: raw.id,
    start: raw.start,
    end: raw.end,
    minutes,
    projectId: typeof raw.projectId === 'string' && raw.projectId ? raw.projectId : null,
    tag: typeof raw.tag === 'string' && raw.tag ? raw.tag : null,
  };
}

/**
 * A complete, well-formed DayRecord from whatever was stored or synced:
 * fills in fields missing from older versions and drops malformed entries,
 * so data from another device can never break the screens.
 */
export function normalizeDay(raw: unknown, date: DateKey, now: string): DayRecord {
  const r = isPlainObject(raw) ? raw : {};
  const ticks = Array.isArray(r.habitTicks) ? r.habitTicks.filter((t): t is string => typeof t === 'string' && !!t) : [];
  const sessions = Array.isArray(r.focusSessions)
    ? r.focusSessions.map(normalizeSession).filter((s): s is FocusSession => s !== null)
    : [];
  return {
    ...r,
    date,
    checkIn: normalizeCheckIn(r.checkIn, now),
    habitTicks: [...new Set(ticks)],
    focusSessions: uniqueById(sessions),
    note: typeof r.note === 'string' ? normalizeNote(r.note) : '',
    noteUpdatedAt: isIso(r.noteUpdatedAt) ? r.noteUpdatedAt : null,
    updatedAt: isIso(r.updatedAt) ? r.updatedAt : now,
  };
}
