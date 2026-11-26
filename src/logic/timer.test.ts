import { describe, expect, it } from 'vitest';
import {
  cancelTimer,
  completesAt,
  elapsedMs,
  extendTimer,
  finishTimer,
  formatClock,
  markSaved,
  needsSave,
  parseTimerState,
  pauseTimer,
  progress,
  remainingMs,
  resumeTimer,
  settle,
  startTimer,
  toFocusSession,
  type TimerState,
} from './timer';

const MIN = 60_000;
const T0 = Date.parse('2026-11-26T09:00:00.000Z');
const at = (minutes: number) => T0 + minutes * MIN;

function countdown(minutes = 25): TimerState {
  return startTimer({
    id: 's1',
    mode: 'countdown',
    minutes,
    tag: { projectId: 'p1', label: null },
    now: T0,
    date: '2026-11-26',
  });
}

function stopwatch(): TimerState {
  return startTimer({ id: 's2', mode: 'stopwatch', minutes: 0, tag: { projectId: null, label: 'Reading' }, now: T0, date: '2026-11-26' });
}

describe('countdown time', () => {
  it('counts from the start timestamp', () => {
    const s = countdown();
    expect(elapsedMs(s, at(10))).toBe(10 * MIN);
    expect(remainingMs(s, at(10))).toBe(15 * MIN);
    expect(progress(s, at(10))).toBeCloseTo(0.4);
  });

  it('is correct after a long gap with no ticks (screen locked, tab in background)', () => {
    const s = countdown();
    // Nothing ran between T0 and 24.5 minutes later; the answer only depends on the clock.
    expect(remainingMs(s, at(24.5))).toBe(0.5 * MIN);
  });

  it('never counts past the target', () => {
    const s = countdown();
    expect(elapsedMs(s, at(40))).toBe(25 * MIN);
    expect(remainingMs(s, at(40))).toBe(0);
    expect(progress(s, at(40))).toBe(1);
  });

  it('ignores a clock that went backwards', () => {
    expect(elapsedMs(countdown(), T0 - 5000)).toBe(0);
  });

  it('knows when it completes', () => {
    expect(completesAt(countdown())).toBe(at(25));
  });
});

describe('settle', () => {
  it('leaves a countdown that has time left alone', () => {
    const s = countdown();
    expect(settle(s, at(24))).toBe(s);
  });

  it('finishes at the exact moment the target was reached, even if noticed later', () => {
    const s = settle(countdown(), at(70)); // e.g. phone unlocked 45 minutes after it ended
    expect(s.status).toBe('finished');
    expect(s.endedAt).toBe(at(25));
    expect(s.accumulatedMs).toBe(25 * MIN);
    expect(s.runningSince).toBeNull();
  });

  it('never finishes a stopwatch on its own', () => {
    const s = stopwatch();
    expect(settle(s, at(600))).toBe(s);
  });
});

describe('pause and resume', () => {
  it('excludes paused time', () => {
    let s = countdown();
    s = pauseTimer(s, at(10));
    expect(s.status).toBe('paused');
    expect(elapsedMs(s, at(30))).toBe(10 * MIN); // frozen while paused
    expect(completesAt(s)).toBeNull();
    s = resumeTimer(s, at(30));
    expect(elapsedMs(s, at(35))).toBe(15 * MIN);
    expect(completesAt(s)).toBe(at(45)); // 15 minutes left from minute 30
  });

  it('handles several pauses', () => {
    let s = stopwatch();
    s = pauseTimer(s, at(5));
    s = resumeTimer(s, at(8));
    s = pauseTimer(s, at(10));
    s = resumeTimer(s, at(20));
    expect(elapsedMs(s, at(21))).toBe(8 * MIN);
  });

  it('pausing a countdown that already ran out finishes it instead', () => {
    const s = pauseTimer(countdown(), at(30));
    expect(s.status).toBe('finished');
    expect(s.endedAt).toBe(at(25));
  });

  it('resume only applies to a paused timer', () => {
    const s = countdown();
    expect(resumeTimer(s, at(3))).toBe(s);
  });
});

describe('finish', () => {
  it('ends a stopwatch now with the focused time', () => {
    let s = stopwatch();
    s = pauseTimer(s, at(20));
    s = resumeTimer(s, at(25));
    s = finishTimer(s, at(47));
    expect(s.status).toBe('finished');
    expect(s.accumulatedMs).toBe(42 * MIN);
    expect(s.endedAt).toBe(at(47));
  });

  it('ends a countdown early', () => {
    const s = finishTimer(countdown(), at(12));
    expect(s.accumulatedMs).toBe(12 * MIN);
    expect(s.endedAt).toBe(at(12));
  });

  it('a late finish on a countdown keeps the real completion time', () => {
    const s = finishTimer(countdown(), at(90));
    expect(s.endedAt).toBe(at(25));
    expect(s.accumulatedMs).toBe(25 * MIN);
  });
});

describe('extend by 5 minutes', () => {
  it('restarts a finished countdown for 5 more minutes from now', () => {
    let s = settle(countdown(), at(26));
    s = extendTimer(s, at(27));
    expect(s.status).toBe('running');
    expect(s.targetMs).toBe(30 * MIN);
    expect(elapsedMs(s, at(27))).toBe(25 * MIN); // the minute between finishing and extending doesn't count
    expect(completesAt(s)).toBe(at(32));
    s = settle(s, at(40));
    expect(s.accumulatedMs).toBe(30 * MIN);
    expect(s.endedAt).toBe(at(32));
  });

  it('adds to a running countdown', () => {
    const s = extendTimer(countdown(), at(10));
    expect(remainingMs(s, at(10))).toBe(20 * MIN);
  });

  it('does nothing to a stopwatch', () => {
    const s = stopwatch();
    expect(extendTimer(s, at(1))).toBe(s);
  });
});

describe('cancel and saving', () => {
  it('cancelling an unsaved session drops it', () => {
    expect(cancelTimer(pauseTimer(countdown(), at(5)))).toBeNull();
  });

  it('a finished session needs saving once', () => {
    let s = settle(countdown(), at(25));
    expect(needsSave(s)).toBe(true);
    s = markSaved(s);
    expect(needsSave(s)).toBe(false);
  });

  it('an extension changes the saved session; cancelling it keeps the original', () => {
    let s = markSaved(settle(countdown(), at(25)));
    s = extendTimer(s, at(26));
    expect(needsSave(s)).toBe(false); // running again
    const cancelled = cancelTimer(s)!;
    expect(cancelled.status).toBe('finished');
    expect(cancelled.accumulatedMs).toBe(25 * MIN);
    expect(cancelled.endedAt).toBe(at(25));
    expect(cancelled.targetMs).toBe(25 * MIN);
    expect(needsSave(cancelled)).toBe(false);

    const extended = settle(s, at(31));
    expect(needsSave(extended)).toBe(true);
    expect(toFocusSession(extended).minutes).toBe(30);
  });

  it('sessions under a minute are not saved', () => {
    expect(needsSave(finishTimer(stopwatch(), T0 + 40_000))).toBe(false);
  });

  it('builds the stored session from timestamps', () => {
    const s = finishTimer(stopwatch(), at(33.6));
    expect(toFocusSession(s)).toEqual({
      id: 's2',
      start: '2026-11-26T09:00:00.000Z',
      end: '2026-11-26T09:33:36.000Z',
      minutes: 34,
      projectId: null,
      tag: 'Reading',
    });
  });

  it('refuses to build a session that has not finished', () => {
    expect(() => toFocusSession(countdown())).toThrow();
  });
});

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(25 * MIN)).toBe('25:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(0)).toBe('0:00');
  });

  it('adds hours when needed', () => {
    expect(formatClock(90 * MIN)).toBe('1:30:00');
    expect(formatClock(3_600_000 + 61_000)).toBe('1:01:01');
  });

  it('rounds countdowns up and elapsed time down', () => {
    expect(formatClock(24 * MIN + 59_400, 'up')).toBe('25:00');
    expect(formatClock(400, 'up')).toBe('0:01');
    expect(formatClock(59_999)).toBe('0:59');
  });

  it('never shows negative time', () => {
    expect(formatClock(-5000)).toBe('0:00');
  });
});

describe('parseTimerState (restore after reload)', () => {
  it('round-trips through JSON', () => {
    const s = pauseTimer(countdown(), at(3));
    expect(parseTimerState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('rejects malformed or inconsistent data', () => {
    expect(parseTimerState(null)).toBeNull();
    expect(parseTimerState('x')).toBeNull();
    expect(parseTimerState({ ...countdown(), v: 2 })).toBeNull();
    expect(parseTimerState({ ...countdown(), runningSince: null })).toBeNull(); // running without a start
    expect(parseTimerState({ ...countdown(), targetMs: null })).toBeNull();
    expect(parseTimerState({ ...countdown(), status: 'finished' })).toBeNull(); // finished without an end
    expect(parseTimerState({ ...countdown(), tag: undefined })).toBeNull();
  });
});
