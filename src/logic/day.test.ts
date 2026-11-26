import { describe, expect, it } from 'vitest';
import { applyCheckIn, applyNote, checkInDefaults, emptyDay, NOTE_MAX_LENGTH, toggleHabitTick } from './day';
import type { CheckIn } from './model';

const T0 = '2026-11-26T07:00:00.000Z';
const T1 = '2026-11-26T07:01:00.000Z';

const previous: CheckIn = {
  bedtime: '23:30',
  wakeTime: '06:45',
  sleepQuality: 4,
  energy: 3,
  mood: 4,
  updatedAt: T0,
};

describe('checkInDefaults', () => {
  it('prefills times from the previous check-in', () => {
    expect(checkInDefaults(previous)).toEqual({ bedtime: '23:30', wakeTime: '06:45', fromPrevious: true });
  });

  it('falls back to sensible defaults', () => {
    expect(checkInDefaults(null)).toEqual({ bedtime: '23:00', wakeTime: '07:00', fromPrevious: false });
  });
});

describe('applyCheckIn', () => {
  it('starts a new check-in from the suggested times, without copying ratings', () => {
    const day = applyCheckIn(emptyDay('2026-11-26', T0), { energy: 5 }, checkInDefaults(previous), T1);
    expect(day.checkIn).toEqual({
      bedtime: '23:30',
      wakeTime: '06:45',
      sleepQuality: null,
      energy: 5,
      mood: null,
      updatedAt: T1,
    });
    expect(day.updatedAt).toBe(T1);
  });

  it('updates an existing check-in without touching other fields', () => {
    const start = { ...emptyDay('2026-11-26', T0), checkIn: previous, note: 'hi' };
    const day = applyCheckIn(start, { bedtime: '23:45' }, checkInDefaults(null), T1);
    expect(day.checkIn).toEqual({ ...previous, bedtime: '23:45', updatedAt: T1 });
    expect(day.note).toBe('hi');
    expect(start.checkIn).toBe(previous); // not mutated
  });
});

describe('applyNote', () => {
  it('stores a single line', () => {
    const day = applyNote(emptyDay('2026-11-26', T0), 'slept\nwell', T1);
    expect(day.note).toBe('slept well');
    expect(day.noteUpdatedAt).toBe(T1);
  });

  it('caps the length', () => {
    expect(applyNote(emptyDay('2026-11-26', T0), 'x'.repeat(500), T1).note).toHaveLength(NOTE_MAX_LENGTH);
  });

  it('returns the same record when nothing changed', () => {
    const day = emptyDay('2026-11-26', T0);
    expect(applyNote(day, '', T1)).toBe(day);
  });
});

describe('toggleHabitTick', () => {
  it('ticks and unticks', () => {
    const day = emptyDay('2026-11-26', T0);
    const ticked = toggleHabitTick(day, 'a', T1);
    expect(ticked.habitTicks).toEqual(['a']);
    expect(toggleHabitTick(ticked, 'a', T1).habitTicks).toEqual([]);
    expect(day.habitTicks).toEqual([]); // not mutated
  });
});
