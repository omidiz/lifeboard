import { describe, expect, it } from 'vitest';
import {
  clampTarget,
  createHabit,
  habitStatus,
  normalizeEmoji,
  normalizeName,
  targetForWeek,
  ticksByHabit,
  updateHabit,
} from './habits';
import type { DateKey, Habit, TargetChange } from './model';

// Reference weeks (Monday starts):
//   2026-11-02, 11-09, 11-16, 11-23 (Mon 23 … Sun 29), 11-30
const NOW = '2026-11-26T08:00:00.000Z';

function habit(target: number, createdOn: DateKey, history?: TargetChange[]): Habit {
  return {
    id: 'h',
    name: 'Read',
    emoji: '📚',
    targetPerWeek: target,
    targetHistory: history ?? [{ weekStart: '2020-01-06', target }],
    createdOn,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const ticks = (...dates: DateKey[]) => new Set(dates);

/** Every day from `from` for `count` days. */
function run(from: DateKey, count: number): DateKey[] {
  const out: DateKey[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('weekly progress', () => {
  it('counts only ticks in the current Monday–Sunday week', () => {
    const h = habit(3, '2026-11-01');
    const s = habitStatus(h, ticks('2026-11-22', '2026-11-23', '2026-11-25'), '2026-11-26');
    expect(s.done).toBe(2); // Sunday 22nd belongs to the previous week
    expect(s.target).toBe(3);
    expect(s.met).toBe(false);
  });

  it('is met once ticks reach the target, and stays met above it', () => {
    const h = habit(2, '2026-11-01');
    expect(habitStatus(h, ticks('2026-11-23', '2026-11-24'), '2026-11-26').met).toBe(true);
    const over = habitStatus(h, ticks('2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'), '2026-11-26');
    expect(over).toMatchObject({ done: 4, target: 2, met: true });
  });

  it('ignores ticks after today', () => {
    const h = habit(3, '2026-11-01');
    expect(habitStatus(h, ticks('2026-11-23', '2026-11-28'), '2026-11-26').done).toBe(1);
  });

  it('handles weeks that span a month and a year', () => {
    const h = habit(4, '2026-12-01');
    const week = ticks('2026-12-28', '2026-12-30', '2027-01-01', '2027-01-03');
    expect(habitStatus(h, week, '2027-01-03')).toMatchObject({ done: 4, met: true });
  });
});

describe('on track', () => {
  it('is on track while enough days remain', () => {
    // Target 5, nothing done by Wednesday: Wed–Sun is exactly 5 days.
    expect(habitStatus(habit(5, '2026-11-01'), ticks(), '2026-11-25').onTrack).toBe(true);
    // By Thursday only 4 days remain.
    expect(habitStatus(habit(5, '2026-11-01'), ticks(), '2026-11-26').onTrack).toBe(false);
  });

  it('counts today as available only if not yet ticked', () => {
    const h = habit(5, '2026-11-01');
    // Thu ticked: 1 done + Fri–Sun 3 left = 4 < 5.
    expect(habitStatus(h, ticks('2026-11-26'), '2026-11-26').onTrack).toBe(false);
    // Wed + Thu ticked: 2 + 3 = 5.
    expect(habitStatus(h, ticks('2026-11-25', '2026-11-26'), '2026-11-26').onTrack).toBe(true);
  });

  it('on Sunday only the day itself is left', () => {
    const h = habit(3, '2026-11-01');
    expect(habitStatus(h, ticks('2026-11-23', '2026-11-25'), '2026-11-29').onTrack).toBe(true);
    expect(habitStatus(h, ticks('2026-11-23'), '2026-11-29').onTrack).toBe(false);
  });
});

describe('streaks', () => {
  const h = habit(3, '2026-11-01');
  const metWeeks = [
    '2026-11-02', '2026-11-04', '2026-11-06',
    '2026-11-09', '2026-11-10', '2026-11-11',
    '2026-11-16', '2026-11-18', '2026-11-22',
  ];

  it('counts consecutive met weeks plus a current week that is on track', () => {
    const s = habitStatus(h, ticks(...metWeeks, '2026-11-23'), '2026-11-24');
    expect(s.streak).toBe(4);
  });

  it('does not break on a Monday before anything is ticked', () => {
    expect(habitStatus(h, ticks(...metWeeks), '2026-11-23').streak).toBe(3);
  });

  it('does not count the current week before its first tick', () => {
    expect(habitStatus(h, ticks(...metWeeks), '2026-11-25').streak).toBe(3);
  });

  it('never breaks on rest days when the weekly target is met', () => {
    // Target 5, done Mon–Fri each week, weekends off.
    const five = habit(5, '2026-11-01');
    const days = [...run('2026-11-02', 5), ...run('2026-11-09', 5), ...run('2026-11-16', 5)];
    expect(habitStatus(five, ticks(...days), '2026-11-23').streak).toBe(3);
  });

  it('is broken by a finished week below target', () => {
    // Week of 11-09 has only 2 ticks.
    const missed = metWeeks.filter((d) => d !== '2026-11-11');
    expect(habitStatus(h, ticks(...missed, '2026-11-23'), '2026-11-24').streak).toBe(2);
  });

  it('keeps past weeks when the current week can no longer be met', () => {
    const daily = habit(7, '2026-11-01');
    const days = [...run('2026-11-09', 7), ...run('2026-11-16', 7)];
    // Monday 23rd missed, now Tuesday: 7 is out of reach.
    const s = habitStatus(daily, ticks(...days, '2026-11-24'), '2026-11-24');
    expect(s.onTrack).toBe(false);
    expect(s.streak).toBe(2);
  });

  it('counts the current week once met even late in the week', () => {
    const s = habitStatus(h, ticks(...metWeeks, '2026-11-27', '2026-11-28', '2026-11-29'), '2026-11-29');
    expect(s).toMatchObject({ met: true, streak: 4 });
  });

  it('is zero without any met week', () => {
    expect(habitStatus(h, ticks('2026-11-16'), '2026-11-26').streak).toBe(0);
  });

  it('runs across a year boundary', () => {
    const daily = habit(2, '2026-12-01');
    const t = ticks('2026-12-21', '2026-12-22', '2026-12-28', '2027-01-03', '2027-01-04');
    expect(habitStatus(daily, t, '2027-01-05').streak).toBe(3);
  });
});

describe('new habits', () => {
  it('starts with no streak and is on track', () => {
    const s = habitStatus(habit(5, '2026-11-26'), ticks(), '2026-11-26');
    expect(s).toEqual({ done: 0, target: 4, met: false, onTrack: true, streak: 0 });
  });

  it('lowers the first week’s target to the days that were left', () => {
    // Created Saturday with target 5: only Sat and Sun remain.
    const h = habit(5, '2026-11-28');
    const s = habitStatus(h, ticks('2026-11-28', '2026-11-29'), '2026-11-29');
    expect(s).toMatchObject({ done: 2, target: 2, met: true, streak: 1 });
  });

  it('does not lower the target when the week has enough days', () => {
    // Created Tuesday with target 3: six days remain.
    expect(habitStatus(habit(3, '2026-11-24'), ticks(), '2026-11-24').target).toBe(3);
  });

  it('counts a met partial first week towards the streak', () => {
    const h = habit(5, '2026-11-21'); // Saturday
    const s = habitStatus(h, ticks('2026-11-21', '2026-11-22', '2026-11-23'), '2026-11-23');
    expect(s.streak).toBe(2);
  });

  it('does not count a missed partial first week', () => {
    const h = habit(5, '2026-11-22'); // Sunday, nothing ticked
    expect(habitStatus(h, ticks('2026-11-23'), '2026-11-23').streak).toBe(1);
  });

  it('ignores weeks before the habit existed', () => {
    const h = habit(3, '2026-11-16');
    const s = habitStatus(h, ticks('2026-11-16', '2026-11-17', '2026-11-18', '2026-11-23'), '2026-11-23');
    expect(s.streak).toBe(2);
  });

  it('counts from the earliest tick when past days were filled in', () => {
    // Created on the 23rd, but the previous week was back-filled.
    const h = habit(3, '2026-11-23');
    const s = habitStatus(h, ticks('2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23'), '2026-11-23');
    expect(s.streak).toBe(2);
  });

  it('handles viewing a date before the habit started', () => {
    expect(habitStatus(habit(3, '2026-11-23'), ticks(), '2026-11-10')).toMatchObject({ done: 0, streak: 0 });
  });
});

describe('edited targets', () => {
  it('judges past weeks by the target that applied then', () => {
    // Target 2 until the week of 11-23, then raised to 5.
    const h = habit(5, '2026-11-01', [
      { weekStart: '2026-10-26', target: 2 },
      { weekStart: '2026-11-23', target: 5 },
    ]);
    const t = ticks('2026-11-09', '2026-11-10', '2026-11-16', '2026-11-17', '2026-11-23');
    const s = habitStatus(h, t, '2026-11-23');
    expect(s.target).toBe(5);
    expect(s.streak).toBe(3); // two weeks at target 2, plus this week on track
  });

  it('applies a lowered target to the current week straight away', () => {
    const h = habit(2, '2026-11-01', [
      { weekStart: '2026-10-26', target: 5 },
      { weekStart: '2026-11-23', target: 2 },
    ]);
    expect(habitStatus(h, ticks('2026-11-23', '2026-11-24'), '2026-11-24')).toMatchObject({ target: 2, met: true });
  });

  it('applies a raised target to the weeks after the change', () => {
    const h = habit(4, '2026-11-01', [
      { weekStart: '2026-10-26', target: 2 },
      { weekStart: '2026-11-16', target: 4 },
    ]);
    // Week of 11-16 has 2 ticks: enough before the change, not after.
    const t = ticks('2026-11-09', '2026-11-10', '2026-11-16', '2026-11-17');
    expect(habitStatus(h, t, '2026-11-23').streak).toBe(0);
  });

  it('looks up targets from unsorted history and before the first change', () => {
    const h = habit(5, '2026-11-01', [
      { weekStart: '2026-11-16', target: 5 },
      { weekStart: '2026-11-02', target: 3 },
    ]);
    expect(targetForWeek(h, '2026-10-26')).toBe(3);
    expect(targetForWeek(h, '2026-11-09')).toBe(3);
    expect(targetForWeek(h, '2026-11-16')).toBe(5);
    expect(targetForWeek(h, '2026-12-07')).toBe(5);
  });

  it('falls back to the current target without history', () => {
    expect(targetForWeek(habit(4, '2026-11-01', []), '2026-11-23')).toBe(4);
  });

  it('records a target edit from the current week, replacing same-week edits', () => {
    let h = habit(3, '2026-11-01', [{ weekStart: '2026-10-26', target: 3 }]);
    h = updateHabit(h, { targetPerWeek: 5 }, '2026-11-24', NOW);
    h = updateHabit(h, { targetPerWeek: 4 }, '2026-11-26', NOW);
    expect(h.targetPerWeek).toBe(4);
    expect(h.targetHistory).toEqual([
      { weekStart: '2026-10-26', target: 3 },
      { weekStart: '2026-11-23', target: 4 },
    ]);
  });

  it('does not touch history when only the name or emoji change', () => {
    const h = habit(3, '2026-11-01');
    const edited = updateHabit(h, { name: 'Read fiction', emoji: '📖' }, '2026-11-26', NOW);
    expect(edited.targetHistory).toBe(h.targetHistory);
    expect(edited).toMatchObject({ name: 'Read fiction', emoji: '📖', targetPerWeek: 3 });
  });
});

describe('creating and normalizing habits', () => {
  it('creates a habit whose target applies from this week', () => {
    const h = createHabit({ name: '  Stretch  ', emoji: '🧘', targetPerWeek: 4 }, 'id1', '2026-11-26', NOW);
    expect(h).toEqual({
      id: 'id1',
      name: 'Stretch',
      emoji: '🧘',
      targetPerWeek: 4,
      targetHistory: [{ weekStart: '2026-11-23', target: 4 }],
      createdOn: '2026-11-26',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('uses defaults for missing values', () => {
    const h = createHabit({ name: '' }, 'id2', '2026-11-26', NOW);
    expect(h).toMatchObject({ name: 'New habit', emoji: '✨', targetPerWeek: 5 });
  });

  it('keeps targets between 1 and 7', () => {
    expect(clampTarget(0)).toBe(1);
    expect(clampTarget(9)).toBe(7);
    expect(clampTarget(3.6)).toBe(4);
    expect(clampTarget(Number.NaN)).toBe(5);
  });

  it('keeps a single emoji, including multi-part ones', () => {
    expect(normalizeEmoji('🏃‍♀️🏃')).toBe('🏃‍♀️');
    expect(normalizeEmoji('👍🏽 nice')).toBe('👍🏽');
    expect(normalizeEmoji('  ')).toBe('✨');
  });

  it('keeps names to one tidy line', () => {
    expect(normalizeName(' Drink\n water ')).toBe('Drink water');
    expect(normalizeName('x'.repeat(100))).toHaveLength(40);
  });

  it('ignores an empty rename', () => {
    expect(updateHabit(habit(3, '2026-11-01'), { name: '   ' }, '2026-11-26', NOW).name).toBe('Read');
  });
});

describe('ticksByHabit', () => {
  it('groups ticks by habit', () => {
    const map = ticksByHabit([
      { date: '2026-11-23', habitTicks: ['a', 'b'] },
      { date: '2026-11-24', habitTicks: ['a'] },
    ]);
    expect(map.get('a')).toEqual(new Set(['2026-11-23', '2026-11-24']));
    expect(map.get('b')).toEqual(new Set(['2026-11-23']));
  });
});
