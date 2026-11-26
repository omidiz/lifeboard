/**
 * Focus timer state and time calculations.
 *
 * All time is derived from wall-clock timestamps (epoch ms), never from
 * counting ticks, so the timer stays correct while the screen is locked,
 * the tab is in the background, or the page is reloaded. A running timer
 * is a timestamp (`runningSince`) plus the focused time banked before it
 * (`accumulatedMs`); pausing banks the current stretch.
 */
import type { DateKey, FocusSession } from './model';

export type TimerMode = 'countdown' | 'stopwatch';
export type TimerStatus = 'running' | 'paused' | 'finished';

export const PRESET_MINUTES = [25, 50, 90] as const;
export const EXTEND_MINUTES = 5;
/** Sessions shorter than this are not worth logging. */
export const MIN_SESSION_MS = 60_000;

const MS_PER_MINUTE = 60_000;

/** What a session is tagged with: an active project, a quick label, or nothing. */
export interface FocusTag {
  projectId: string | null;
  label: string | null;
}

export const NO_TAG: FocusTag = { projectId: null, label: null };

export interface TimerState {
  v: 1;
  /** Becomes the FocusSession id, so saving the same session twice replaces it. */
  id: string;
  mode: TimerMode;
  /** Countdown length (grows with extensions); null for the stopwatch. */
  targetMs: number | null;
  /** When the session was first started (epoch ms). */
  startedAt: number;
  /** Local date the session started on: the day file it is saved to. */
  date: DateKey;
  /** Focused time banked before the current running stretch. */
  accumulatedMs: number;
  /** Start of the current running stretch; null unless running. */
  runningSince: number | null;
  status: TimerStatus;
  /** When the session ended; set once finished. */
  endedAt: number | null;
  tag: FocusTag;
  /** What was last written to the day file, so extensions can be undone and saves aren't repeated. */
  saved: { accumulatedMs: number; endedAt: number; targetMs: number | null } | null;
}

export interface StartOptions {
  id: string;
  mode: TimerMode;
  /** Countdown length in minutes; ignored for the stopwatch. */
  minutes: number;
  tag: FocusTag;
  now: number;
  date: DateKey;
}

export function startTimer({ id, mode, minutes, tag, now, date }: StartOptions): TimerState {
  return {
    v: 1,
    id,
    mode,
    targetMs: mode === 'countdown' ? Math.max(1, minutes) * MS_PER_MINUTE : null,
    startedAt: now,
    date,
    accumulatedMs: 0,
    runningSince: now,
    status: 'running',
    endedAt: null,
    tag: { ...tag },
    saved: null,
  };
}

/** Focused time so far (pauses excluded). A countdown never counts past its target. */
export function elapsedMs(state: TimerState, now: number): number {
  const stretch = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  const total = state.accumulatedMs + stretch;
  return state.targetMs === null ? total : Math.min(total, state.targetMs);
}

/** Time left on a countdown; null for the stopwatch. */
export function remainingMs(state: TimerState, now: number): number | null {
  if (state.targetMs === null) return null;
  return Math.max(0, state.targetMs - elapsedMs(state, now));
}

/** The moment a running countdown reaches its target; null if it isn't counting down right now. */
export function completesAt(state: TimerState): number | null {
  if (state.targetMs === null || state.runningSince === null) return null;
  return state.runningSince + Math.max(0, state.targetMs - state.accumulatedMs);
}

/** Fraction of the countdown done (0–1); for the stopwatch, progress through the current hour. */
export function progress(state: TimerState, now: number): number {
  const elapsed = elapsedMs(state, now);
  if (state.targetMs === null) return (elapsed % (60 * MS_PER_MINUTE)) / (60 * MS_PER_MINUTE);
  return state.targetMs === 0 ? 1 : Math.min(1, elapsed / state.targetMs);
}

/**
 * Brings the state up to date: a countdown whose target has passed becomes
 * finished, ending at the exact moment the target was reached (not when
 * the app happened to notice, e.g. after the phone was unlocked).
 */
export function settle(state: TimerState, now: number): TimerState {
  const end = completesAt(state);
  if (state.status !== 'running' || end === null || now < end) return state;
  return {
    ...state,
    status: 'finished',
    accumulatedMs: state.targetMs!,
    runningSince: null,
    endedAt: end,
  };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  const s = settle(state, now);
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', accumulatedMs: elapsedMs(s, now), runningSince: null };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', runningSince: now };
}

/** Ends the session now (stopwatch, or a countdown ended early). */
export function finishTimer(state: TimerState, now: number): TimerState {
  const s = settle(state, now);
  if (s.status === 'finished') return s;
  return { ...s, status: 'finished', accumulatedMs: elapsedMs(s, now), runningSince: null, endedAt: now };
}

/**
 * Adds minutes to a countdown. A finished countdown starts running again
 * from now; time between finishing and extending doesn't count.
 */
export function extendTimer(state: TimerState, now: number, minutes = EXTEND_MINUTES): TimerState {
  if (state.mode !== 'countdown' || state.targetMs === null) return state;
  const extra = minutes * MS_PER_MINUTE;
  if (state.status === 'finished') {
    return {
      ...state,
      status: 'running',
      targetMs: state.accumulatedMs + extra,
      runningSince: now,
      endedAt: null,
    };
  }
  return { ...state, targetMs: state.targetMs + extra };
}

/**
 * Cancels the session. Nothing is saved, unless part of it was already
 * saved before an extension: then only the extension is dropped and the
 * saved session is kept as it was.
 */
export function cancelTimer(state: TimerState): TimerState | null {
  if (!state.saved) return null;
  return {
    ...state,
    status: 'finished',
    accumulatedMs: state.saved.accumulatedMs,
    endedAt: state.saved.endedAt,
    targetMs: state.saved.targetMs,
    runningSince: null,
  };
}

export function isTooShort(state: TimerState): boolean {
  return state.accumulatedMs < MIN_SESSION_MS;
}

/** True when a finished session has changes not yet written to its day file. */
export function needsSave(state: TimerState): boolean {
  if (state.status !== 'finished' || state.endedAt === null || isTooShort(state)) return false;
  return !state.saved || state.saved.accumulatedMs !== state.accumulatedMs || state.saved.endedAt !== state.endedAt;
}

export function markSaved(state: TimerState): TimerState {
  if (state.endedAt === null) return state;
  return { ...state, saved: { accumulatedMs: state.accumulatedMs, endedAt: state.endedAt, targetMs: state.targetMs } };
}

/** The session as stored in days/YYYY-MM-DD.json. Requires a finished state. */
export function toFocusSession(state: TimerState): FocusSession {
  if (state.endedAt === null) throw new Error('Timer has not finished');
  return {
    id: state.id,
    start: new Date(state.startedAt).toISOString(),
    end: new Date(state.endedAt).toISOString(),
    minutes: Math.round(state.accumulatedMs / MS_PER_MINUTE),
    projectId: state.tag.projectId,
    tag: state.tag.label,
  };
}

/**
 * Formats a duration as "M:SS" or "H:MM:SS". Countdowns round seconds up
 * (so a fresh 25-minute timer reads 25:00, and 0:00 means done); elapsed
 * time rounds down.
 */
export function formatClock(ms: number, round: 'up' | 'down' = 'down'): string {
  const seconds = round === 'up' ? Math.ceil(Math.max(0, ms) / 1000) : Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Reads a stored timer back, rejecting anything malformed. */
export function parseTimerState(raw: unknown): TimerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const tag = s.tag as Record<string, unknown> | undefined;
  const saved = s.saved as Record<string, unknown> | null | undefined;
  const valid =
    s.v === 1 &&
    typeof s.id === 'string' &&
    (s.mode === 'countdown' || s.mode === 'stopwatch') &&
    isNumOrNull(s.targetMs) &&
    (s.mode === 'stopwatch') === (s.targetMs === null) &&
    isNum(s.startedAt) &&
    typeof s.date === 'string' &&
    isNum(s.accumulatedMs) &&
    isNumOrNull(s.runningSince) &&
    (s.status === 'running' || s.status === 'paused' || s.status === 'finished') &&
    (s.status === 'running') === (s.runningSince !== null) &&
    isNumOrNull(s.endedAt) &&
    (s.status === 'finished') === (s.endedAt !== null) &&
    !!tag &&
    isStrOrNull(tag.projectId) &&
    isStrOrNull(tag.label) &&
    (saved === null ||
      (!!saved && isNum(saved.accumulatedMs) && isNum(saved.endedAt) && isNumOrNull(saved.targetMs)));
  return valid ? (raw as TimerState) : null;
}
