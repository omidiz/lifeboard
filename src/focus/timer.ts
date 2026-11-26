/**
 * The one focus timer of the app. It lives outside the Focus screen, so a
 * countdown keeps running, finishes, chimes and saves while another screen
 * is open.
 *
 * The timer state is kept in localStorage (it is device-local and must be
 * readable synchronously on load to restore the clock without a flash);
 * finished sessions go to IndexedDB like every other day change.
 */
import { updateDay } from '../data/db';
import { todayKey } from '../logic/dates';
import { normalizeLabel, rememberLabel, upsertFocusSession } from '../logic/focus';
import {
  cancelTimer,
  completesAt,
  extendTimer,
  finishTimer,
  isTooShort,
  markSaved,
  needsSave,
  NO_TAG,
  parseTimerState,
  pauseTimer,
  resumeTimer,
  settle,
  startTimer,
  toFocusSession,
  type FocusTag,
  type TimerMode,
  type TimerState,
} from '../logic/timer';
import type { DateKey } from '../logic/model';
import { playChime, primeAudio, vibrate } from './chime';

const STATE_KEY = 'lifeboard.focus.timer';
const PREFS_KEY = 'lifeboard.focus.prefs';
const LABELS_KEY = 'lifeboard.focus.recentLabels';

/** Only chime if the end was just now; coming back an hour later shouldn't make noise. */
const CHIME_WINDOW_MS = 60_000;

export interface FocusPrefs {
  mode: TimerMode;
  minutes: number;
  tag: FocusTag;
}

export type SaveStatus = { kind: 'idle' } | { kind: 'saved'; date: DateKey } | { kind: 'error' } | { kind: 'too-short' };

type Listener = () => void;

let state: TimerState | null = null;
let saveStatus: SaveStatus = { kind: 'idle' };
let completionTimer: number | undefined;
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<Listener>();
const savedListeners = new Set<(date: DateKey) => void>();

// ---- localStorage helpers (private browsing can throw) ----

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the timer still works for this page load.
  }
}

// ---- Public read API ----

export function getTimer(): TimerState | null {
  return state;
}

export function getSaveStatus(): SaveStatus {
  return saveStatus;
}

export function getPrefs(): FocusPrefs {
  const raw = readJson(PREFS_KEY) as Partial<FocusPrefs> | null;
  const mode = raw?.mode === 'stopwatch' ? 'stopwatch' : 'countdown';
  const minutes = typeof raw?.minutes === 'number' && raw.minutes > 0 ? raw.minutes : 25;
  const tag =
    raw?.tag && typeof raw.tag === 'object'
      ? {
          projectId: typeof raw.tag.projectId === 'string' ? raw.tag.projectId : null,
          label: typeof raw.tag.label === 'string' ? raw.tag.label : null,
        }
      : NO_TAG;
  return { mode, minutes, tag };
}

export function getRecentLabels(): string[] {
  const raw = readJson(LABELS_KEY);
  return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string' && !!normalizeLabel(l)) : [];
}

export function addRecentLabel(label: string): string[] {
  const next = rememberLabel(getRecentLabels(), label);
  writeJson(LABELS_KEY, next);
  return next;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called with the day's date whenever a session is written to it. */
export function onSessionSaved(listener: (date: DateKey) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

// ---- State changes ----

function emit(): void {
  listeners.forEach((l) => l());
}

function setState(next: TimerState | null): void {
  state = next;
  writeJson(STATE_KEY, next);
  schedule();
  if (next && needsSave(next)) void persist();
  emit();
}

/** Wakes up exactly when a running countdown should end. */
function schedule(): void {
  window.clearTimeout(completionTimer);
  const end = state && state.status === 'running' ? completesAt(state) : null;
  if (end === null) return;
  // Browsers cap timeouts at ~24.8 days; a focus session never gets close.
  completionTimer = window.setTimeout(tick, Math.max(0, end - Date.now()) + 50);
}

/** Re-checks the clock: finishes a countdown whose time is up. */
export function tick(): void {
  if (!state) return;
  const now = Date.now();
  const next = settle(state, now);
  if (next === state) {
    schedule();
    return;
  }
  if (next.status === 'finished' && now - next.endedAt! < CHIME_WINDOW_MS) {
    playChime();
    vibrate();
  }
  setState(next);
}

function persist(): Promise<void> {
  saving = saving.then(async () => {
    const current = state;
    if (!current || !needsSave(current)) return;
    const session = toFocusSession(current);
    try {
      await updateDay(current.date, (day) => upsertFocusSession(day, session, new Date().toISOString()));
      // Only mark saved if nothing changed meanwhile (e.g. an extension started).
      if (state && state.id === current.id && state.endedAt === current.endedAt && state.accumulatedMs === current.accumulatedMs) {
        state = markSaved(state);
        writeJson(STATE_KEY, state);
      }
      saveStatus = { kind: 'saved', date: current.date };
      savedListeners.forEach((l) => l(current.date));
    } catch (error) {
      console.error('Saving focus session failed', error);
      saveStatus = { kind: 'error' };
    }
    emit();
  });
  return saving;
}

export function start(mode: TimerMode, minutes: number, tag: FocusTag): void {
  primeAudio();
  const label = tag.label ? normalizeLabel(tag.label) || null : null;
  const cleanTag: FocusTag = { projectId: tag.projectId, label: tag.projectId ? null : label };
  if (cleanTag.label) addRecentLabel(cleanTag.label);
  writeJson(PREFS_KEY, { mode, minutes, tag: cleanTag } satisfies FocusPrefs);
  saveStatus = { kind: 'idle' };
  const now = Date.now();
  setState(startTimer({ id: crypto.randomUUID(), mode, minutes, tag: cleanTag, now, date: todayKey(new Date(now)) }));
}

export function pause(): void {
  if (state) setState(pauseTimer(state, Date.now()));
}

export function resume(): void {
  primeAudio();
  if (state) setState(resumeTimer(state, Date.now()));
}

/** Ends the session now and saves it (unless it's under a minute). */
export function finish(): void {
  if (!state) return;
  const next = finishTimer(state, Date.now());
  if (isTooShort(next) && !next.saved) {
    saveStatus = { kind: 'too-short' };
    setState(null);
    return;
  }
  setState(next);
}

export function extend(): void {
  primeAudio();
  if (state) setState(extendTimer(settle(state, Date.now()), Date.now()));
}

/** Discards the running session (an already-saved part before an extension is kept). */
export function cancel(): void {
  if (!state) return;
  saveStatus = { kind: 'idle' };
  setState(cancelTimer(state));
}

/** Clears a finished session from the screen. */
export function dismiss(): void {
  if (state?.status !== 'finished') return;
  saveStatus = { kind: 'idle' };
  setState(null);
}

/** Restores a timer left running or finished before the page was closed. */
export function initFocusTimer(): void {
  state = parseTimerState(readJson(STATE_KEY));
  if (state) {
    const settled = settle(state, Date.now());
    // Finished while the app was closed: save quietly, no chime for old news.
    state = settled;
    writeJson(STATE_KEY, state);
    if (needsSave(state)) void persist();
  }
  schedule();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('pageshow', tick);
  // Another tab changed the timer: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== STATE_KEY) return;
    state = parseTimerState(readJson(STATE_KEY));
    schedule();
    emit();
  });
}
