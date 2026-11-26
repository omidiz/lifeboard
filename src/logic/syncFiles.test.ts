import { describe, expect, it } from 'vitest';
import { emptyDay, toggleHabitTick } from './day';
import {
  dayPath,
  decodeBase64Utf8,
  encodeBase64Utf8,
  HABITS_PATH,
  mergeSyncFile,
  parseSyncFile,
  parseSyncPath,
  PROJECTS_PATH,
  serializeSyncFile,
} from './syncFiles';

const NOW = '2026-11-26T08:00:00.000Z';

describe('sync paths', () => {
  it('maps repo paths to Lifeboard files', () => {
    expect(parseSyncPath(dayPath('2026-11-26'))).toEqual({ kind: 'day', date: '2026-11-26' });
    expect(parseSyncPath(HABITS_PATH)).toEqual({ kind: 'habits' });
    expect(parseSyncPath(PROJECTS_PATH)).toEqual({ kind: 'projects' });
  });

  it('ignores other files in the repo', () => {
    for (const path of ['README.md', 'days/2026-02-30.json', 'days/notes.json', 'other/habits.json', 'days/2026-11-26.json.bak']) {
      expect(parseSyncPath(path)).toBeNull();
    }
  });
});

describe('parseSyncFile', () => {
  it('parses and normalizes a day file', () => {
    const day = toggleHabitTick(emptyDay('2026-11-26', NOW), 'walk', NOW);
    const parsed = parseSyncFile(dayPath('2026-11-26'), serializeSyncFile(day), NOW);
    expect(parsed).toEqual({ ok: true, value: day });
  });

  it('rejects broken JSON, non-objects and mismatched dates', () => {
    expect(parseSyncFile(HABITS_PATH, '{ nope', NOW)).toMatchObject({ ok: false });
    expect(parseSyncFile(HABITS_PATH, '[1,2]', NOW)).toMatchObject({ ok: false });
    expect(parseSyncFile(dayPath('2026-11-26'), '{"date":"2026-11-25"}', NOW)).toMatchObject({ ok: false });
    expect(parseSyncFile('README.md', '{}', NOW)).toMatchObject({ ok: false });
  });

  it('fills in an empty habits file', () => {
    expect(parseSyncFile(HABITS_PATH, '{}', NOW)).toEqual({ ok: true, value: { habits: [], updatedAt: NOW } });
  });
});

describe('mergeSyncFile', () => {
  it('dispatches by path', () => {
    const base = emptyDay('2026-11-26', NOW);
    const merged = mergeSyncFile(dayPath('2026-11-26'), base, toggleHabitTick(base, 'a', NOW), toggleHabitTick(base, 'b', NOW));
    expect((merged as typeof base).habitTicks).toEqual(['a', 'b']);
  });
});

describe('base64', () => {
  it('round-trips UTF-8 text, including emoji', () => {
    const text = serializeSyncFile({ note: 'Café ☕️ — good day 🌱', emoji: '🧘🏽‍♀️' });
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it('decodes GitHub’s line-wrapped base64', () => {
    const encoded = encodeBase64Utf8('x'.repeat(200));
    const wrapped = encoded.replace(/(.{60})/g, '$1\n');
    expect(decodeBase64Utf8(wrapped)).toBe('x'.repeat(200));
  });

  it('matches standard base64 for ASCII', () => {
    expect(encodeBase64Utf8('{"a":1}')).toBe('eyJhIjoxfQ==');
  });

  it('throws on invalid UTF-8 instead of producing garbage', () => {
    expect(() => decodeBase64Utf8(btoa('\xff\xfe'))).toThrow();
  });
});
