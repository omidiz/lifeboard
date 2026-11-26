import { describe, expect, it } from 'vitest';
import { emptyDay } from './day';
import { normalizeLabel, rememberLabel, totalFocusMinutes, upsertFocusSession } from './focus';
import type { FocusSession } from './model';

const NOW = '2026-11-26T12:00:00.000Z';

const session = (id: string, start: string, minutes: number): FocusSession => ({
  id,
  start,
  end: start,
  minutes,
  projectId: null,
  tag: null,
});

describe('labels', () => {
  it('normalizes whitespace and length', () => {
    expect(normalizeLabel('  deep   work ')).toBe('deep work');
    expect(normalizeLabel('x'.repeat(60))).toHaveLength(40);
    expect(normalizeLabel('   ')).toBe('');
  });

  it('remembers the most recent label first, without duplicates', () => {
    expect(rememberLabel(['Reading', 'Email'], 'email')).toEqual(['email', 'Reading']);
    expect(rememberLabel(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(rememberLabel(['a'], '  ')).toEqual(['a']);
  });
});

describe('focus sessions in a day', () => {
  it('adds sessions in start order and replaces by id', () => {
    let day = emptyDay('2026-11-26', NOW);
    day = upsertFocusSession(day, session('b', '2026-11-26T10:00:00.000Z', 25), NOW);
    day = upsertFocusSession(day, session('a', '2026-11-26T08:00:00.000Z', 50), NOW);
    day = upsertFocusSession(day, session('b', '2026-11-26T10:00:00.000Z', 30), NOW);
    expect(day.focusSessions.map((s) => [s.id, s.minutes])).toEqual([
      ['a', 50],
      ['b', 30],
    ]);
    expect(totalFocusMinutes(day.focusSessions)).toBe(80);
  });

  it('ignores bad minute values in the total', () => {
    expect(totalFocusMinutes([session('a', NOW, NaN), session('b', NOW, -3), session('c', NOW, 10)])).toBe(10);
  });
});
