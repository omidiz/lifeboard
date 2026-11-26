import { describe, expect, it } from 'vitest';
import { applyCheckIn, applyNote, checkInDefaults, emptyDay, toggleHabitTick } from './day';
import { upsertFocusSession } from './focus';
import { createHabit, updateHabit } from './habits';
import { mergeCheckIn, mergeDay, mergeHabits, mergeIdSet, mergeProjects, mergeValue } from './merge';
import type { CheckIn, DayRecord, FocusSession, HabitsFile, ProjectsFile } from './model';
import {
  addMilestone,
  addWeeklyGoal,
  changeProject,
  createProject,
  removeMilestone,
  removeProject,
  removeWeeklyGoal,
  renameMilestone,
  toggleMilestone,
  toggleWeeklyGoal,
  updateProject,
} from './projects';

const DATE = '2026-11-26';
const WEEK = '2026-11-23';
// Timestamps through the day; later letters are later.
const T = (minute: number) => new Date(Date.UTC(2026, 10, 26, 7, minute)).toISOString();

const defaults = checkInDefaults({
  bedtime: '23:00',
  wakeTime: '07:00',
  sleepQuality: null,
  energy: null,
  mood: null,
  updatedAt: T(0),
});

function session(id: string, startMinute: number, minutes: number): FocusSession {
  return {
    id,
    start: T(startMinute),
    end: T(startMinute + minutes),
    minutes,
    projectId: null,
    tag: null,
  };
}

/** Merging from both sides gives the same result (both devices converge). */
function expectSymmetric<T>(merge: (b: T | null, l: T, r: T) => T, base: T | null, a: T, b: T): T {
  const ab = merge(base, a, b);
  const ba = merge(base, b, a);
  expect(ab).toEqual(ba);
  return ab;
}

describe('mergeValue', () => {
  it('takes the side that changed since the base', () => {
    expect(mergeValue(1, 1, 2, 'local')).toBe(2);
    expect(mergeValue(1, 3, 1, 'remote')).toBe(3);
  });

  it('uses the tie-breaker when both changed, or with no base', () => {
    expect(mergeValue(1, 2, 3, 'local')).toBe(2);
    expect(mergeValue(1, 2, 3, 'remote')).toBe(3);
    expect(mergeValue(undefined, 2, 3, 'remote')).toBe(3);
  });

  it('compares objects by value, not identity or key order', () => {
    expect(mergeValue({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 9, b: 2 }, 'local')).toEqual({ a: 9, b: 2 });
  });
});

describe('mergeIdSet', () => {
  it('is a plain union without a base', () => {
    expect(mergeIdSet(null, ['a', 'b'], ['c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps additions from both sides', () => {
    expect(mergeIdSet(['a'], ['a', 'b'], ['a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps a removal from either side instead of bringing it back', () => {
    expect(mergeIdSet(['a', 'b'], ['b'], ['a', 'b'])).toEqual(['b']);
    expect(mergeIdSet(['a', 'b'], ['a', 'b'], ['a'])).toEqual(['a']);
  });

  it('handles a removal on one side and an addition on the other', () => {
    expect(mergeIdSet(['a'], [], ['a', 'b'])).toEqual(['b']);
  });
});

describe('mergeDay: two devices editing the same day offline', () => {
  // Both devices synced this morning version, then went offline.
  const morning: DayRecord = (() => {
    let d = emptyDay(DATE, T(0));
    d = applyCheckIn(d, { bedtime: '23:15', sleepQuality: 4 }, defaults, T(1));
    d = toggleHabitTick(d, 'water', T(2));
    return d;
  })();

  // Phone: energy, ticks "walk", unticks "water", logs a focus session.
  const phone = (() => {
    let d = applyCheckIn(morning, { energy: 4 }, defaults, T(10));
    d = toggleHabitTick(d, 'walk', T(11));
    d = toggleHabitTick(d, 'water', T(12));
    d = upsertFocusSession(d, session('s-phone', 20, 25), T(45));
    return d;
  })();

  // Laptop: mood, ticks "read", writes the note, logs its own session.
  const laptop = (() => {
    let d = applyCheckIn(morning, { mood: 3 }, defaults, T(15));
    d = toggleHabitTick(d, 'read', T(16));
    d = applyNote(d, 'Good long walk', T(17));
    d = upsertFocusSession(d, session('s-laptop', 60, 50), T(110));
    return d;
  })();

  it('keeps every change from both devices', () => {
    const merged = expectSymmetric(mergeDay, morning, phone, laptop);
    expect(merged.checkIn).toMatchObject({
      bedtime: '23:15',
      wakeTime: '07:00',
      sleepQuality: 4,
      energy: 4,
      mood: 3,
      updatedAt: T(15),
    });
    // "water" was unticked on the phone and must not come back from the laptop's copy.
    expect(merged.habitTicks).toEqual(['read', 'walk']);
    expect(merged.focusSessions.map((s) => s.id)).toEqual(['s-phone', 's-laptop']);
    expect(merged.note).toBe('Good long walk');
    expect(merged.noteUpdatedAt).toBe(T(17));
    expect(merged.updatedAt).toBe(T(110));
  });

  it('is stable: merging the result again changes nothing', () => {
    const merged = mergeDay(morning, phone, laptop);
    expect(mergeDay(merged, merged, merged)).toEqual(merged);
    expect(mergeDay(morning, merged, laptop)).toEqual(merged);
    expect(mergeDay(laptop, merged, laptop)).toEqual(merged);
  });

  it('fast-forwards when only one side changed', () => {
    expect(mergeDay(morning, morning, phone)).toEqual({ ...phone, habitTicks: [...phone.habitTicks].sort() });
    expect(mergeDay(morning, laptop, morning)).toEqual({ ...laptop, habitTicks: [...laptop.habitTicks].sort() });
  });

  it('lets the later check-in win when both changed the same field', () => {
    const a = applyCheckIn(morning, { energy: 2, bedtime: '22:45' }, defaults, T(20));
    const b = applyCheckIn(morning, { energy: 5 }, defaults, T(30));
    const merged = expectSymmetric(mergeDay, morning, a, b);
    expect(merged.checkIn?.energy).toBe(5);
    // Only one side moved the bedtime, so that change survives the newer check-in.
    expect(merged.checkIn?.bedtime).toBe('22:45');
  });

  it('keeps a one-sided change even when the other side is newer', () => {
    const early = applyCheckIn(morning, { sleepQuality: 2 }, defaults, T(5));
    const late = applyCheckIn(morning, { mood: 5 }, defaults, T(50));
    const merged = expectSymmetric(mergeDay, morning, early, late);
    expect(merged.checkIn).toMatchObject({ sleepQuality: 2, mood: 5 });
  });

  it('lets the later note win when both edited it', () => {
    const a = applyNote(morning, 'Tired', T(20));
    const b = applyNote(morning, 'Actually fine', T(25));
    const merged = expectSymmetric(mergeDay, morning, a, b);
    expect(merged.note).toBe('Actually fine');
    expect(merged.noteUpdatedAt).toBe(T(25));
  });

  it('keeps a one-sided note edit over an untouched older note', () => {
    const withNote = applyNote(morning, 'First', T(5));
    const a = applyNote(withNote, 'Edited on phone', T(30));
    const b = toggleHabitTick(withNote, 'read', T(40));
    expect(mergeDay(withNote, a, b).note).toBe('Edited on phone');
    expect(mergeDay(withNote, b, a).note).toBe('Edited on phone');
  });

  it('keeps an extended focus session (+5 min) over the original', () => {
    const base = upsertFocusSession(morning, session('s', 20, 25), T(45));
    const extended = upsertFocusSession(base, session('s', 20, 30), T(50));
    const other = toggleHabitTick(base, 'read', T(55));
    const merged = expectSymmetric(mergeDay, base, extended, other);
    expect(merged.focusSessions).toEqual([session('s', 20, 30)]);
    expect(merged.habitTicks).toEqual(['read', 'water']);
  });

  it('picks the later end when the same session changed on both sides', () => {
    const base = upsertFocusSession(morning, session('s', 20, 25), T(45));
    const a = upsertFocusSession(base, session('s', 20, 30), T(50));
    const b = upsertFocusSession(base, session('s', 20, 35), T(55));
    expect(expectSymmetric(mergeDay, base, a, b).focusSessions).toEqual([session('s', 20, 35)]);
  });

  it('never loses a session that only one device knows about', () => {
    const merged = expectSymmetric(
      mergeDay,
      morning,
      upsertFocusSession(morning, session('a', 30, 25), T(55)),
      upsertFocusSession(morning, session('b', 10, 25), T(35)),
    );
    expect(merged.focusSessions.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('mergeDay: first sync (no base)', () => {
  it('takes the union of ticks and sessions', () => {
    const a = upsertFocusSession(toggleHabitTick(emptyDay(DATE, T(0)), 'walk', T(1)), session('a', 5, 25), T(30));
    const b = upsertFocusSession(toggleHabitTick(emptyDay(DATE, T(0)), 'read', T(2)), session('b', 40, 25), T(65));
    const merged = expectSymmetric(mergeDay, null, a, b);
    expect(merged.habitTicks).toEqual(['read', 'walk']);
    expect(merged.focusSessions.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('prefers an answer over "not answered" in the check-in', () => {
    const a = applyCheckIn(emptyDay(DATE, T(0)), { energy: 4 }, defaults, T(10));
    const b = applyCheckIn(emptyDay(DATE, T(0)), { mood: 2 }, defaults, T(20));
    expect(expectSymmetric(mergeDay, null, a, b).checkIn).toMatchObject({ energy: 4, mood: 2 });
  });

  it('keeps a check-in that only one side has', () => {
    const a = applyCheckIn(emptyDay(DATE, T(0)), { energy: 4 }, defaults, T(10));
    const b = toggleHabitTick(emptyDay(DATE, T(0)), 'walk', T(20));
    const merged = expectSymmetric(mergeDay, null, a, b);
    expect(merged.checkIn?.energy).toBe(4);
    expect(merged.habitTicks).toEqual(['walk']);
  });

  it('keeps a note from the side that wrote one', () => {
    const a = applyNote(emptyDay(DATE, T(0)), 'Hello', T(5));
    const b = toggleHabitTick(emptyDay(DATE, T(0)), 'walk', T(20));
    expect(expectSymmetric(mergeDay, null, a, b).note).toBe('Hello');
  });
});

describe('mergeCheckIn', () => {
  const c = (patch: Partial<CheckIn>): CheckIn => ({
    bedtime: '23:00',
    wakeTime: '07:00',
    sleepQuality: null,
    energy: null,
    mood: null,
    updatedAt: T(0),
    ...patch,
  });

  it('returns null only when neither side has a check-in', () => {
    expect(mergeCheckIn(null, null, null)).toBeNull();
    expect(mergeCheckIn(null, c({ energy: 3 }), null)?.energy).toBe(3);
  });

  it('settles a tie in timestamps the same way on both devices', () => {
    const a = c({ energy: 2, updatedAt: T(5) });
    const b = c({ energy: 4, updatedAt: T(5) });
    expect(mergeCheckIn(c({}), a, b)).toEqual(mergeCheckIn(c({}), b, a));
  });
});

describe('mergeHabits', () => {
  const walk = createHabit({ name: 'Walk', emoji: '🚶', targetPerWeek: 5 }, 'walk', DATE, T(0));
  const read = createHabit({ name: 'Read', emoji: '📚', targetPerWeek: 3 }, 'read', DATE, T(1));
  const base: HabitsFile = { habits: [walk, read], updatedAt: T(1) };
  const withHabits = (habits: HabitsFile['habits'], at: string): HabitsFile => ({ habits, updatedAt: at });

  it('merges a rename on one device with a target change on the other', () => {
    const a = withHabits([updateHabit(walk, { name: 'Evening walk' }, DATE, T(10)), read], T(10));
    const b = withHabits([updateHabit(walk, { targetPerWeek: 7 }, DATE, T(20)), read], T(20));
    const merged = expectSymmetric(mergeHabits, base, a, b);
    expect(merged.habits[0]).toMatchObject({ name: 'Evening walk', targetPerWeek: 7, updatedAt: T(20) });
    expect(merged.habits[0].targetHistory.at(-1)).toEqual({ weekStart: WEEK, target: 7 });
  });

  it('lets the later edit win when both renamed', () => {
    const a = withHabits([updateHabit(walk, { name: 'Stroll' }, DATE, T(10)), read], T(10));
    const b = withHabits([updateHabit(walk, { name: 'Hike' }, DATE, T(20)), read], T(20));
    expect(expectSymmetric(mergeHabits, base, a, b).habits[0].name).toBe('Hike');
  });

  it('deletes a habit removed on one device and untouched on the other', () => {
    const a = withHabits([read], T(10));
    const b = withHabits([walk, updateHabit(read, { emoji: '📖' }, DATE, T(20))], T(20));
    const merged = expectSymmetric(mergeHabits, base, a, b);
    expect(merged.habits.map((h) => h.id)).toEqual(['read']);
    expect(merged.habits[0].emoji).toBe('📖');
  });

  it('keeps a habit deleted on one device but edited on the other', () => {
    const a = withHabits([read], T(10));
    const b = withHabits([updateHabit(walk, { name: 'Walk the dog' }, DATE, T(20)), read], T(20));
    const merged = expectSymmetric(mergeHabits, base, a, b);
    expect(merged.habits.map((h) => h.name)).toEqual(['Walk the dog', 'Read']);
  });

  it('keeps habits created on both devices, in creation order', () => {
    const yoga = createHabit({ name: 'Yoga' }, 'yoga', DATE, T(30));
    const stretch = createHabit({ name: 'Stretch' }, 'stretch', DATE, T(25));
    const merged = expectSymmetric(
      mergeHabits,
      base,
      withHabits([walk, read, yoga], T(30)),
      withHabits([walk, read, stretch], T(25)),
    );
    expect(merged.habits.map((h) => h.id)).toEqual(['walk', 'read', 'stretch', 'yoga']);
  });

  it('takes the union on first sync', () => {
    const merged = expectSymmetric(mergeHabits, null, withHabits([walk], T(0)), withHabits([read], T(1)));
    expect(merged.habits.map((h) => h.id)).toEqual(['walk', 'read']);
  });
});

describe('mergeProjects', () => {
  const thesis = addMilestone(
    addMilestone(createProject({ name: 'Thesis' }, 'thesis', T(0)), 'Outline', 'm1', T(1)),
    'Draft',
    'm2',
    T(2),
  );
  const base: ProjectsFile = addWeeklyGoal(
    { projects: [thesis], weeklyGoals: [], updatedAt: T(2) },
    'Finish outline',
    'g1',
    WEEK,
    T(3),
  );
  const edit = (file: ProjectsFile, change: (p: typeof thesis) => typeof thesis, at: string) =>
    changeProject(file, 'thesis', change, at);

  it('keeps different milestones checked on two devices', () => {
    const a = edit(base, (p) => toggleMilestone(p, 'm1', T(10)), T(10));
    const b = edit(base, (p) => toggleMilestone(p, 'm2', T(20)), T(20));
    const merged = expectSymmetric(mergeProjects, base, a, b);
    expect(merged.projects[0].milestones.map((m) => m.done)).toEqual([true, true]);
  });

  it('merges a status change with a color change', () => {
    const a = edit(base, (p) => updateProject(p, { status: 'paused' }, T(10)), T(10));
    const b = edit(base, (p) => updateProject(p, { color: '#5b7fa6' }, T(20)), T(20));
    expect(expectSymmetric(mergeProjects, base, a, b).projects[0]).toMatchObject({ status: 'paused', color: '#5b7fa6' });
  });

  it('lets the later project edit win a milestone renamed on both', () => {
    const a = edit(base, (p) => renameMilestone(p, 'm1', 'Rough outline', T(10)), T(10));
    const b = edit(base, (p) => renameMilestone(p, 'm1', 'Full outline', T(20)), T(20));
    expect(expectSymmetric(mergeProjects, base, a, b).projects[0].milestones[0].title).toBe('Full outline');
  });

  it('removes a milestone deleted on one device, keeps one added on the other', () => {
    const a = edit(base, (p) => removeMilestone(p, 'm2', T(10)), T(10));
    const b = edit(base, (p) => addMilestone(p, 'Submit', 'm3', T(20)), T(20));
    const merged = expectSymmetric(mergeProjects, base, a, b);
    expect(merged.projects[0].milestones.map((m) => m.id).sort()).toEqual(['m1', 'm3']);
  });

  it('deletes a project removed on one device and untouched on the other', () => {
    const a = removeProject(base, 'thesis', T(10));
    const b = toggleWeeklyGoal(base, 'g1', T(20));
    const merged = expectSymmetric(mergeProjects, base, a, b);
    expect(merged.projects).toEqual([]);
    expect(merged.weeklyGoals[0].done).toBe(true);
  });

  it('keeps a project deleted on one device but edited on the other', () => {
    const a = removeProject(base, 'thesis', T(10));
    const b = edit(base, (p) => toggleMilestone(p, 'm1', T(20)), T(20));
    expect(expectSymmetric(mergeProjects, base, a, b).projects).toHaveLength(1);
  });

  it('keeps every goal added offline, even past the weekly limit of 3', () => {
    const a = addWeeklyGoal(addWeeklyGoal(base, 'Gym twice', 'a1', WEEK, T(10)), 'Call mum', 'a2', WEEK, T(11));
    const b = addWeeklyGoal(addWeeklyGoal(base, 'Read a book', 'b1', WEEK, T(20)), 'Tidy desk', 'b2', WEEK, T(21));
    const merged = mergeProjects(base, a, b);
    expect(merged.weeklyGoals.map((g) => g.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'g1']);
    expect(mergeProjects(base, b, a).weeklyGoals.map((g) => g.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'g1']);
  });

  it('keeps a goal removed on one device but ticked on the other', () => {
    const a = removeWeeklyGoal(base, 'g1', T(10));
    const b = toggleWeeklyGoal(base, 'g1', T(20));
    const merged = expectSymmetric(mergeProjects, base, a, b);
    expect(merged.weeklyGoals).toMatchObject([{ id: 'g1', done: true }]);
  });

  it('removes a goal removed on one device and untouched on the other', () => {
    const a = removeWeeklyGoal(base, 'g1', T(10));
    const b = edit(base, (p) => toggleMilestone(p, 'm1', T(20)), T(20));
    expect(expectSymmetric(mergeProjects, base, a, b).weeklyGoals).toEqual([]);
  });

  it('takes the union on first sync', () => {
    const other = createProject({ name: 'Garden' }, 'garden', T(5));
    const merged = mergeProjects(null, base, { projects: [other], weeklyGoals: [], updatedAt: T(5) });
    expect(merged.projects.map((p) => p.id)).toEqual(['thesis', 'garden']);
    expect(merged.weeklyGoals).toHaveLength(1);
  });
});
