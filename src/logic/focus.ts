/** Focus sessions in day files, and the quick labels used to tag them. */
import type { DayRecord, FocusSession } from './model';

export const LABEL_MAX_LENGTH = 40;
export const MAX_RECENT_LABELS = 8;

/** Trims and collapses whitespace; empty means "no label". */
export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX_LENGTH).trim();
}

/** Puts a label first in the recent list (case-insensitive dedupe), keeping at most `max`. */
export function rememberLabel(recent: readonly string[], label: string, max = MAX_RECENT_LABELS): string[] {
  const clean = normalizeLabel(label);
  if (!clean) return [...recent];
  const key = clean.toLowerCase();
  return [clean, ...recent.filter((l) => l.toLowerCase() !== key)].slice(0, max);
}

/** Adds a session to the day, or replaces the one with the same id (e.g. after an extension). */
export function upsertFocusSession(day: DayRecord, session: FocusSession, now: string): DayRecord {
  const others = day.focusSessions.filter((s) => s.id !== session.id);
  const focusSessions = [...others, session].sort((a, b) => a.start.localeCompare(b.start));
  return { ...day, focusSessions, updatedAt: now };
}

export function totalFocusMinutes(sessions: readonly FocusSession[]): number {
  return sessions.reduce((sum, s) => sum + (Number.isFinite(s.minutes) ? Math.max(0, s.minutes) : 0), 0);
}
