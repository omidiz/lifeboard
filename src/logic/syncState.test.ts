import { describe, expect, it } from 'vitest';
import { emptyDay, toggleHabitTick } from './day';
import { dayPath } from './syncFiles';
import { afterPush, fileSyncState, markDirty, resolveRemote, type SyncMeta } from './syncState';

const NOW = '2026-11-26T08:00:00.000Z';
const PATH = dayPath('2026-11-26');
const base = emptyDay('2026-11-26', NOW);

describe('fileSyncState', () => {
  it('treats a file without bookkeeping as never synced and unsynced', () => {
    expect(fileSyncState(null)).toEqual({ sha: null, dirty: true });
    expect(fileSyncState({ sha: 'abc', base, dirty: false, rev: 3 })).toEqual({ sha: 'abc', dirty: false });
  });
});

describe('markDirty', () => {
  it('marks a change and bumps the revision, keeping the base', () => {
    expect(markDirty(null)).toEqual({ sha: null, base: null, dirty: true, rev: 1 });
    expect(markDirty({ sha: 'abc', base, dirty: false, rev: 4 })).toEqual({ sha: 'abc', base, dirty: true, rev: 5 });
  });
});

describe('resolveRemote', () => {
  const remote = toggleHabitTick(base, 'remote', NOW);

  it('takes the remote file when there is nothing local', () => {
    const r = resolveRemote(PATH, null, null, remote, 'r1');
    expect(r).toEqual({ content: remote, meta: { sha: 'r1', base: remote, dirty: false, rev: 1 }, localChanged: true });
  });

  it('takes the remote file when nothing changed locally since the last sync', () => {
    const meta: SyncMeta = { sha: 's0', base, dirty: false, rev: 2 };
    const r = resolveRemote(PATH, base, meta, remote, 'r1');
    expect(r.content).toEqual(remote);
    expect(r.meta).toEqual({ sha: 'r1', base: remote, dirty: false, rev: 3 });
  });

  it('merges local changes and keeps the file dirty so the merge is pushed', () => {
    const local = toggleHabitTick(base, 'local', NOW);
    const r = resolveRemote(PATH, local, { sha: 's0', base, dirty: true, rev: 5 }, remote, 'r1');
    expect((r.content as typeof base).habitTicks).toEqual(['local', 'remote']);
    expect(r.meta).toMatchObject({ sha: 'r1', base: remote, dirty: true, rev: 6 });
    expect(r.localChanged).toBe(true);
  });

  it('merges a never-synced local file without a base (union)', () => {
    const local = toggleHabitTick(base, 'local', NOW);
    const r = resolveRemote(PATH, local, null, remote, 'r1');
    expect((r.content as typeof base).habitTicks).toEqual(['local', 'remote']);
    expect(r.meta.dirty).toBe(true);
  });

  it('is clean when the local change was already on GitHub', () => {
    const r = resolveRemote(PATH, remote, { sha: 's0', base, dirty: true, rev: 5 }, remote, 'r1');
    expect(r.meta).toEqual({ sha: 'r1', base: remote, dirty: false, rev: 5 });
    expect(r.localChanged).toBe(false);
  });
});

describe('afterPush', () => {
  it('marks the file synced when nothing changed during the push', () => {
    expect(afterPush({ sha: 's0', base, dirty: true, rev: 7 }, 's1', remoteOf(base), 7)).toEqual({
      sha: 's1',
      base: remoteOf(base),
      dirty: false,
      rev: 7,
    });
  });

  it('keeps an edit made during the push as unsynced', () => {
    expect(afterPush({ sha: 's0', base, dirty: true, rev: 8 }, 's1', base, 7)).toMatchObject({ sha: 's1', dirty: true, rev: 8 });
  });
});

function remoteOf(day: typeof base) {
  return toggleHabitTick(day, 'x', NOW);
}
