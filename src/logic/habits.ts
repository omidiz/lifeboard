import { addDays, daysBetween, isDateKey, startOfWeek, weekdayIndex } from './dates';
import { isPlainObject, uniqueById } from './json';
import type { DateKey, Habit, HabitsFile, TargetChange } from './model';

export const MIN_TARGET = 1;
export const MAX_TARGET = 7;
export const DEFAULT_TARGET = 5;
export const DEFAULT_EMOJI = '✨';
export const NAME_MAX_LENGTH = 40;

export function clampTarget(target: number): number {
  if (!Number.isFinite(target)) return DEFAULT_TARGET;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(target)));
}

// ---------- Editing habits ----------

/** Keeps the first emoji (or other single character) of the input. */
export function normalizeEmoji(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_EMOJI;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value;
  return first?.segment ?? DEFAULT_EMOJI;
}

export function normalizeName(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

export interface NewHabit {
  name: string;
  emoji?: string;
  targetPerWeek?: number;
}

export function createHabit(input: NewHabit, id: string, today: DateKey, now: string): Habit {
  const target = clampTarget(input.targetPerWeek ?? DEFAULT_TARGET);
  return {
    id,
    name: normalizeName(input.name) || 'New habit',
    emoji: normalizeEmoji(input.emoji ?? DEFAULT_EMOJI),
    targetPerWeek: target,
    targetHistory: [{ weekStart: startOfWeek(today), target }],
    createdOn: today,
    createdAt: now,
    updatedAt: now,
  };
}

export type HabitPatch = Partial<Pick<Habit, 'name' | 'emoji' | 'targetPerWeek'>>;

/**
 * Applies an edit. A new target applies from the current week onwards;
 * several changes within one week keep only the last.
 */
export function updateHabit(habit: Habit, patch: HabitPatch, today: DateKey, now: string): Habit {
  const next: Habit = { ...habit, updatedAt: now };
  if (patch.name !== undefined) next.name = normalizeName(patch.name) || habit.name;
  if (patch.emoji !== undefined) next.emoji = normalizeEmoji(patch.emoji);
  if (patch.targetPerWeek !== undefined) {
    const target = clampTarget(patch.targetPerWeek);
    const weekStart = startOfWeek(today);
    const earlier = habit.targetHistory.filter((change) => change.weekStart < weekStart);
    next.targetPerWeek = target;
    next.targetHistory = [...earlier, { weekStart, target }];
  }
  return next;
}

// ---------- Weekly targets ----------

/** The target that applied in a given week. */
export function targetForWeek(habit: Pick<Habit, 'targetPerWeek' | 'targetHistory'>, weekStart: DateKey): number {
  const history = [...habit.targetHistory].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (history.length === 0) return clampTarget(habit.targetPerWeek);
  let applied: TargetChange = history[0];
  for (const change of history) {
    if (change.weekStart <= weekStart) applied = change;
    else break;
  }
  return clampTarget(applied.target);
}

// ---------- Progress and streaks ----------

export interface HabitStatus {
  /** Ticks in the week containing `day`. */
  done: number;
  /** What that week asks for; lower in the habit's first, partial week. */
  target: number;
  /** done >= target. */
  met: boolean;
  /** The target can still be reached this week (always true once met). */
  onTrack: boolean;
  /**
   * Consecutive weeks that met their target, ending last week, plus this
   * week once it has a tick and is met or still on track. A rest day or an
   * unfinished week never breaks it; only a finished week below target does.
   */
  streak: number;
}

/** First day the habit counts from: when it was created, or the earliest tick if days were filled in retroactively. */
function habitStart(habit: Pick<Habit, 'createdOn'>, ticks: ReadonlySet<DateKey>, today: DateKey): DateKey {
  let start = habit.createdOn;
  for (const tick of ticks) {
    if (tick < start && tick <= today) start = tick;
  }
  return start;
}

function countTicks(ticks: ReadonlySet<DateKey>, from: DateKey, to: DateKey): number {
  let count = 0;
  for (const tick of ticks) {
    if (tick >= from && tick <= to) count += 1;
  }
  return count;
}

/**
 * Target for a week, reduced in the habit's first week to the days that
 * were left in it, so a habit created on Saturday with a target of 5 isn't
 * born with a missed week.
 */
function effectiveTarget(
  habit: Pick<Habit, 'targetPerWeek' | 'targetHistory'>,
  weekStart: DateKey,
  start: DateKey,
): number {
  const target = targetForWeek(habit, weekStart);
  if (weekStart !== startOfWeek(start)) return target;
  return Math.min(target, 7 - weekdayIndex(start));
}

/**
 * Weekly progress and streak for a habit.
 *
 * @param ticks  Dates the habit was ticked on (ticks after `today` are ignored).
 * @param today  The current date; its week is the one still in progress.
 */
export function habitStatus(
  habit: Pick<Habit, 'targetPerWeek' | 'targetHistory' | 'createdOn'>,
  ticks: ReadonlySet<DateKey>,
  today: DateKey,
): HabitStatus {
  const start = habitStart(habit, ticks, today);
  const startWeek = startOfWeek(start);
  const week = startOfWeek(today);

  if (today < start) {
    return { done: 0, target: targetForWeek(habit, week), met: false, onTrack: true, streak: 0 };
  }

  const weekEnd = addDays(week, 6);
  const done = countTicks(ticks, week, today);
  const target = effectiveTarget(habit, week, start);
  const met = done >= target;
  // Days still available this week: today (if not yet ticked) through Sunday.
  const daysLeft = daysBetween(today, weekEnd) + 1 - (ticks.has(today) ? 1 : 0);
  const onTrack = met || done + daysLeft >= target;

  let streak = done > 0 && onTrack ? 1 : 0;
  for (let w = addDays(week, -7); w >= startWeek; w = addDays(w, -7)) {
    const weekTicks = countTicks(ticks, w, addDays(w, 6));
    if (weekTicks < effectiveTarget(habit, w, start)) break;
    streak += 1;
  }

  return { done, target, met, onTrack, streak };
}

/** Groups day records' habit ticks by habit id. */
export function ticksByHabit(days: Iterable<{ date: DateKey; habitTicks: readonly string[] }>): Map<string, Set<DateKey>> {
  const map = new Map<string, Set<DateKey>>();
  for (const day of days) {
    for (const id of day.habitTicks) {
      let set = map.get(id);
      if (!set) map.set(id, (set = new Set()));
      set.add(day.date);
    }
  }
  return map;
}

// ---------- Reading stored or synced data ----------

/** Used only for a synced habit with no usable creation date. */
const FALLBACK_CREATED_ON: DateKey = '2000-01-03';

function normalizeHabit(raw: unknown, now: string): Habit | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now;
  const fromCreatedAt = createdAt.slice(0, 10);
  const createdOn =
    typeof raw.createdOn === 'string' && isDateKey(raw.createdOn)
      ? raw.createdOn
      : isDateKey(fromCreatedAt)
        ? fromCreatedAt
        : FALLBACK_CREATED_ON;
  const target = clampTarget(typeof raw.targetPerWeek === 'number' ? raw.targetPerWeek : DEFAULT_TARGET);
  const history = Array.isArray(raw.targetHistory)
    ? raw.targetHistory
        .filter((c): c is TargetChange => isPlainObject(c) && typeof c.weekStart === 'string' && isDateKey(c.weekStart))
        .map((c) => ({ weekStart: c.weekStart, target: clampTarget(Number(c.target)) }))
    : [];
  return {
    ...raw,
    id: raw.id,
    name: typeof raw.name === 'string' ? normalizeName(raw.name) || 'Habit' : 'Habit',
    emoji: typeof raw.emoji === 'string' ? normalizeEmoji(raw.emoji) : DEFAULT_EMOJI,
    targetPerWeek: target,
    targetHistory: history.length > 0 ? history : [{ weekStart: startOfWeek(createdOn), target }],
    createdOn,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt,
  };
}

/** A well-formed habits.json from stored or synced data; malformed habits are dropped. */
export function normalizeHabitsFile(raw: unknown, now: string): HabitsFile {
  const r = isPlainObject(raw) ? raw : {};
  const habits = Array.isArray(r.habits) ? r.habits.map((h) => normalizeHabit(h, now)).filter((h): h is Habit => h !== null) : [];
  return {
    ...r,
    habits: uniqueById(habits),
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : now,
  };
}
