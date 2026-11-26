import { describe, expect, it } from 'vitest';
import { applyCheckIn, applyNote, checkInDefaults, emptyDay, toggleHabitTick } from '../logic/day';
import { upsertFocusSession } from '../logic/focus';
import { createHabit, updateHabit } from '../logic/habits';
import type { DayRecord, FocusSession, HabitsFile } from '../logic/model';
import { dayPath, HABITS_PATH, serializeSyncFile } from '../logic/syncFiles';
import { SyncError } from '../logic/syncErrors';
import { runSync } from './engine';
import { FakeRepo, MemoryStore } from './testing';

const DATE = '2026-11-26';
const DAY = dayPath(DATE);
const T = (minute: number) => new Date(Date.UTC(2026, 10, 26, 7, minute)).toISOString();
const defaults = checkInDefaults(null);
const now = () => T(500);

const editDay = (device: MemoryStore, change: (d: DayRecord) => DayRecord) =>
  device.edit<DayRecord>(DAY, (d) => change(d ?? emptyDay(DATE, T(0))));

const session = (id: string, start: number, minutes: number): FocusSession => ({
  id,
  start: T(start),
  end: T(start + minutes),
  minutes,
  projectId: null,
  tag: null,
});

function setup() {
  const repo = new FakeRepo();
  const phone = new MemoryStore();
  const laptop = new MemoryStore();
  const sync = (device: MemoryStore) => runSync(device, repo.client(), { now });
  return { repo, phone, laptop, sync };
}

describe('runSync: first sync', () => {
  it('pushes every local file to an empty repo, then has nothing left to do', async () => {
    const { repo, phone, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    phone.edit<HabitsFile>(HABITS_PATH, () => ({ habits: [createHabit({ name: 'Walk' }, 'walk', DATE, T(0))], updatedAt: T(0) }));

    expect(await sync(phone)).toMatchObject({ pushed: 2, pulled: 0 });
    expect(repo.json<DayRecord>(DAY)?.habitTicks).toEqual(['walk']);
    expect(phone.unsynced()).toEqual([]);

    expect(await sync(phone)).toEqual({ pulled: 0, pushed: 0, skipped: [], changedLocally: [] });
  });

  it('downloads everything to a new device without pushing it back', async () => {
    const { repo, phone, laptop, sync } = setup();
    editDay(phone, (d) => applyNote(d, 'Hello 🌱', T(1)));
    await sync(phone);
    const commits = repo.commits;

    const report = await sync(laptop);
    expect(report).toMatchObject({ pulled: 1, pushed: 0, changedLocally: [DAY] });
    expect(laptop.read<DayRecord>(DAY)?.note).toBe('Hello 🌱');
    expect(laptop.unsynced()).toEqual([]);
    expect(repo.commits).toBe(commits);
  });

  it('ignores files in the repo that aren’t Lifeboard data', async () => {
    const { repo, laptop, sync } = setup();
    repo.write('README.md', '# My data');
    repo.write('days/notes.txt', 'x');
    expect(await sync(laptop)).toMatchObject({ pulled: 0, pushed: 0 });
    expect(laptop.files.size).toBe(0);
  });
});

describe('runSync: two devices editing the same day offline', () => {
  it('merges both devices’ changes and both end up with the same day', async () => {
    const { repo, phone, laptop, sync } = setup();
    // Morning: check-in on the phone, synced to both.
    editDay(phone, (d) => toggleHabitTick(applyCheckIn(d, { sleepQuality: 4 }, defaults, T(1)), 'water', T(2)));
    await sync(phone);
    await sync(laptop);

    // Both offline. Phone: energy, ticks walk, unticks water, a focus session.
    editDay(phone, (d) => applyCheckIn(d, { energy: 4 }, defaults, T(10)));
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(11)));
    editDay(phone, (d) => toggleHabitTick(d, 'water', T(12)));
    editDay(phone, (d) => upsertFocusSession(d, session('s-phone', 20, 25), T(45)));
    // Laptop: mood, ticks read, a note, its own session.
    editDay(laptop, (d) => applyCheckIn(d, { mood: 3 }, defaults, T(15)));
    editDay(laptop, (d) => toggleHabitTick(d, 'read', T(16)));
    editDay(laptop, (d) => applyNote(d, 'Long walk', T(17)));
    editDay(laptop, (d) => upsertFocusSession(d, session('s-laptop', 60, 50), T(110)));

    // Back online: phone syncs first, then the laptop has to merge, then the phone catches up.
    await sync(phone);
    const laptopReport = await sync(laptop);
    expect(laptopReport).toMatchObject({ pulled: 1, pushed: 1 });
    await sync(phone);

    const onPhone = phone.read<DayRecord>(DAY)!;
    const onLaptop = laptop.read<DayRecord>(DAY)!;
    const onGitHub = repo.json<DayRecord>(DAY)!;
    expect(onPhone).toEqual(onLaptop);
    expect(onGitHub).toEqual(onLaptop);

    expect(onGitHub.checkIn).toMatchObject({ sleepQuality: 4, energy: 4, mood: 3 });
    expect(onGitHub.habitTicks).toEqual(['read', 'walk']);
    expect(onGitHub.focusSessions.map((s) => s.id)).toEqual(['s-phone', 's-laptop']);
    expect(onGitHub.note).toBe('Long walk');
    expect(phone.unsynced()).toEqual([]);
    expect(laptop.unsynced()).toEqual([]);

    // Settled: nothing more to do on either device.
    expect(await sync(phone)).toMatchObject({ pulled: 0, pushed: 0 });
    expect(await sync(laptop)).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keeps an untick from one device instead of bringing the tick back', async () => {
    const { phone, laptop, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    await sync(phone);
    await sync(laptop);

    editDay(laptop, (d) => toggleHabitTick(d, 'walk', T(5))); // untick
    editDay(phone, (d) => applyNote(d, 'note', T(6)));
    await sync(laptop);
    await sync(phone);
    await sync(laptop);

    expect(phone.read<DayRecord>(DAY)?.habitTicks).toEqual([]);
    expect(laptop.read<DayRecord>(DAY)).toEqual(phone.read<DayRecord>(DAY));
  });

  it('merges two devices that each created the same day before ever syncing', async () => {
    const { repo, phone, laptop, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(applyCheckIn(d, { energy: 2 }, defaults, T(1)), 'walk', T(2)));
    editDay(laptop, (d) => toggleHabitTick(applyCheckIn(d, { mood: 5 }, defaults, T(3)), 'read', T(4)));
    await sync(phone);
    await sync(laptop);
    await sync(phone);
    expect(repo.json<DayRecord>(DAY)).toMatchObject({ habitTicks: ['read', 'walk'], checkIn: { energy: 2, mood: 5 } });
    expect(phone.read(DAY)).toEqual(laptop.read(DAY));
  });

  it('propagates a deleted habit, and keeps one edited elsewhere', async () => {
    const { phone, laptop, sync } = setup();
    const walk = createHabit({ name: 'Walk' }, 'walk', DATE, T(0));
    const read = createHabit({ name: 'Read' }, 'read', DATE, T(1));
    phone.edit<HabitsFile>(HABITS_PATH, () => ({ habits: [walk, read], updatedAt: T(1) }));
    await sync(phone);
    await sync(laptop);

    // Phone deletes both; laptop renames "read" meanwhile.
    phone.edit<HabitsFile>(HABITS_PATH, () => ({ habits: [], updatedAt: T(10) }));
    laptop.edit<HabitsFile>(HABITS_PATH, (f) => ({
      habits: f!.habits.map((h) => (h.id === 'read' ? updateHabit(h, { name: 'Read fiction' }, DATE, T(20)) : h)),
      updatedAt: T(20),
    }));
    await sync(phone);
    await sync(laptop);
    await sync(phone);

    expect(phone.read<HabitsFile>(HABITS_PATH)?.habits.map((h) => h.name)).toEqual(['Read fiction']);
    expect(laptop.read(HABITS_PATH)).toEqual(phone.read(HABITS_PATH));
  });
});

describe('runSync: races and failures', () => {
  it('merges and retries when another device pushes the same file mid-sync (stale SHA)', async () => {
    const { repo, phone, laptop, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    await sync(phone);
    await sync(laptop);

    editDay(phone, (d) => toggleHabitTick(d, 'read', T(5)));
    editDay(laptop, (d) => toggleHabitTick(d, 'yoga', T(6)));
    // Right before the phone's upload, the laptop's lands first.
    let raced = false;
    repo.beforePut = async () => {
      if (raced) return;
      raced = true;
      repo.beforePut = null;
      await sync(laptop);
    };

    const report = await sync(phone);
    expect(raced).toBe(true);
    expect(report.pushed).toBe(1);
    expect(repo.json<DayRecord>(DAY)?.habitTicks).toEqual(['read', 'walk', 'yoga']);
    await sync(laptop);
    expect(laptop.read(DAY)).toEqual(phone.read(DAY));
  });

  it('keeps an edit made while its file was being pushed as unsynced', async () => {
    const { repo, phone, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    repo.beforePut = () => {
      repo.beforePut = null;
      editDay(phone, (d) => toggleHabitTick(d, 'read', T(2)));
    };
    await sync(phone);
    expect(phone.unsynced()).toEqual([DAY]);
    expect(repo.json<DayRecord>(DAY)?.habitTicks).toEqual(['walk']);

    await sync(phone);
    expect(phone.unsynced()).toEqual([]);
    expect(repo.json<DayRecord>(DAY)?.habitTicks).toEqual(['walk', 'read']);
  });

  it('never applies or overwrites a broken file on GitHub', async () => {
    const { repo, phone, sync } = setup();
    editDay(phone, (d) => applyNote(d, 'Mine', T(1)));
    await sync(phone);
    repo.write(DAY, '{ this is not json');
    editDay(phone, (d) => applyNote(d, 'Mine, edited', T(2)));

    const report = await sync(phone);
    expect(report.skipped).toEqual([DAY]);
    expect(report.pushed).toBe(0);
    expect(phone.read<DayRecord>(DAY)?.note).toBe('Mine, edited');
    expect(repo.files.get(DAY)?.text).toBe('{ this is not json');
    expect(phone.unsynced()).toEqual([DAY]);
  });

  it('picks up where it left off after going offline mid-sync', async () => {
    const { repo, phone, sync } = setup();
    for (const date of ['2026-11-24', '2026-11-25', '2026-11-26']) {
      phone.edit<DayRecord>(dayPath(date), () => toggleHabitTick(emptyDay(date, T(0)), 'walk', T(1)));
    }
    // The connection drops after the first upload.
    repo.beforePut = () => {
      repo.beforePut = () => {
        throw new SyncError('offline');
      };
    };
    await expect(sync(phone)).rejects.toMatchObject({ kind: 'offline' });
    expect(phone.unsynced()).toHaveLength(2);

    repo.beforePut = null;
    expect(await sync(phone)).toMatchObject({ pushed: 2 });
    expect(phone.unsynced()).toEqual([]);
    expect(repo.files.size).toBe(3);
  });

  it('recreates a file that was deleted on GitHub', async () => {
    const { repo, phone, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    await sync(phone);
    repo.files.delete(DAY);
    editDay(phone, (d) => toggleHabitTick(d, 'read', T(2)));
    expect(await sync(phone)).toMatchObject({ pushed: 1 });
    expect(repo.json<DayRecord>(DAY)?.habitTicks).toEqual(['walk', 'read']);
  });

  it('stops with a clear error when the token can only read', async () => {
    const { repo, phone, sync } = setup();
    repo.info.canPush = false;
    await expect(sync(phone)).rejects.toMatchObject({ kind: 'read-only' });
  });

  it('gives up after repeated conflicts instead of looping', async () => {
    const { repo, phone, sync } = setup();
    editDay(phone, (d) => toggleHabitTick(d, 'walk', T(1)));
    await sync(phone);
    editDay(phone, (d) => toggleHabitTick(d, 'read', T(2)));
    // Another writer changes the file before every upload.
    repo.beforePut = (path) => {
      repo.write(path, serializeSyncFile(toggleHabitTick(emptyDay(DATE, T(0)), `other-${repo.commits}`, T(3))));
    };
    await expect(sync(phone)).rejects.toMatchObject({ kind: 'conflict' });
    // The local change is still there and still waiting to sync.
    expect(phone.read<DayRecord>(DAY)?.habitTicks).toContain('read');
    expect(phone.unsynced()).toEqual([DAY]);
  });
});

describe('runSync: repo checks', () => {
  it('runs onRepoVerified only once the repo is reachable and writable', async () => {
    const { repo, phone } = setup();
    let verified = 0;
    const onRepoVerified = async () => {
      verified += 1;
    };
    repo.info.canPush = false;
    await expect(runSync(phone, repo.client(), { onRepoVerified })).rejects.toMatchObject({ kind: 'read-only' });
    repo.failWith = new SyncError('not-found', 404);
    await expect(runSync(phone, repo.client(), { onRepoVerified })).rejects.toMatchObject({ kind: 'not-found' });
    expect(verified).toBe(0);

    repo.failWith = null;
    repo.info.canPush = true;
    await runSync(phone, repo.client(), { onRepoVerified });
    expect(verified).toBe(1);
  });
});
