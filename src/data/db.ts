/**
 * Local storage on IndexedDB. Every change is written here first and marked
 * unsynced in the same transaction; sync to the lifeboard-data repo reads
 * from these stores.
 *
 * Stores:
 *   days     — one DayRecord per date (keyPath "date"), like days/YYYY-MM-DD.json
 *   files    — the shared files, keyed "habits" and "projects"
 *   sync     — per repo path: SHA, base copy, unsynced flag (see logic/syncState)
 *   settings — this device only, never synced: the GitHub sync config (incl. token)
 */
import { emptyDay, normalizeDay } from '../logic/day';
import { normalizeHabitsFile, ticksByHabit } from '../logic/habits';
import { deepEqual } from '../logic/json';
import type { CheckIn, DateKey, DayRecord, FocusSession, HabitsFile, ProjectsFile } from '../logic/model';
import { normalizeProjectsFile } from '../logic/projects';
import type { SyncConfig } from '../logic/syncConfig';
import { dayPath, HABITS_PATH, parseSyncPath, PROJECTS_PATH, type SyncFile } from '../logic/syncFiles';
import { afterPush, fileSyncState, markDirty, resolveRemote, type FileSyncState, type SyncMeta } from '../logic/syncState';
import type { SyncStore } from '../sync/types';
import { localChanges } from './changes';

const DB_NAME = 'lifeboard';
const DB_VERSION = 2;
const DAYS = 'days';
const FILES = 'files';
const SYNC = 'sync';
const SETTINGS = 'settings';

const SYNC_CONFIG_KEY = 'githubSync';
const SYNC_TARGET_KEY = 'syncTarget';

type FileKey = 'habits' | 'projects';

const FILE_PATHS: Record<FileKey, string> = { habits: HABITS_PATH, projects: PROJECTS_PATH };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DAYS)) db.createObjectStore(DAYS, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      // Version 2: files from version 1 have no sync entry, so they count as unsynced.
      if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC);
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it isn't blocked, reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Lifeboard is open in another tab with an older version.'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

const nowIso = () => new Date().toISOString();

const normalizeHabits = (raw: unknown) => normalizeHabitsFile(raw, nowIso());
const normalizeProjects = (raw: unknown) => normalizeProjectsFile(raw, nowIso());

/** Marks a path unsynced, inside the transaction that changed it. */
function markDirtyIn(tx: IDBTransaction, path: string): void {
  const store = tx.objectStore(SYNC);
  const get = store.get(path);
  get.onsuccess = () => store.put(markDirty(get.result as SyncMeta | undefined), path);
}

// ---- Days ----

export async function getDay(date: DateKey): Promise<DayRecord | null> {
  const db = await openDb();
  const raw = await requestResult<unknown>(db.transaction(DAYS).objectStore(DAYS).get(date));
  return raw ? normalizeDay(raw, date, nowIso()) : null;
}

/**
 * Reads, changes and writes a day in a single transaction, so quick
 * successive edits (e.g. tapping +15 min repeatedly) never overwrite
 * each other. The day is marked unsynced in the same transaction.
 */
export async function updateDay(date: DateKey, change: (day: DayRecord) => DayRecord): Promise<DayRecord> {
  const db = await openDb();
  const tx = db.transaction([DAYS, SYNC], 'readwrite');
  const store = tx.objectStore(DAYS);
  let result: DayRecord | undefined;
  let changed = false;
  const get = store.get(date);
  get.onsuccess = () => {
    const raw: unknown = get.result;
    const current = raw ? normalizeDay(raw, date, nowIso()) : emptyDay(date, nowIso());
    result = { ...change(current), date };
    if (deepEqual(result, current)) return;
    changed = true;
    store.put(result);
    markDirtyIn(tx, dayPath(date));
  };
  await transactionDone(tx);
  if (changed) localChanges.emit(dayPath(date));
  return result!;
}

/** The most recent check-in strictly before the given date, looking back at most maxDays days. */
export async function findLatestCheckInBefore(date: DateKey, maxDays = 60): Promise<CheckIn | null> {
  const db = await openDb();
  const store = db.transaction(DAYS).objectStore(DAYS);
  const cursorRequest = store.openCursor(IDBKeyRange.upperBound(date, true), 'prev');
  return new Promise((resolve, reject) => {
    let seen = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || seen >= maxDays) {
        resolve(null);
        return;
      }
      seen += 1;
      const day = normalizeDay(cursor.value, String(cursor.key), nowIso());
      if (day.checkIn) resolve(day.checkIn);
      else cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

/** All days in [from, to], inclusive, in date order. */
export async function getDaysInRange(from: DateKey, to: DateKey): Promise<DayRecord[]> {
  const db = await openDb();
  const raws = await requestResult<{ date: DateKey }[]>(
    db.transaction(DAYS).objectStore(DAYS).getAll(IDBKeyRange.bound(from, to)),
  );
  return raws.map((raw) => normalizeDay(raw, raw.date, nowIso()));
}

async function getAllDays(): Promise<DayRecord[]> {
  const db = await openDb();
  const raws = await requestResult<{ date: DateKey }[]>(db.transaction(DAYS).objectStore(DAYS).getAll());
  return raws.map((raw) => normalizeDay(raw, raw.date, nowIso()));
}

/** Every date each habit was ticked on, by habit id. */
export async function getAllHabitTicks(): Promise<Map<string, Set<DateKey>>> {
  return ticksByHabit(await getAllDays());
}

/** Every focus session ever logged, across all days. */
export async function getAllFocusSessions(): Promise<FocusSession[]> {
  return (await getAllDays()).flatMap((d) => d.focusSessions);
}

// ---- Habits & projects ----

async function getFile<T>(key: FileKey, normalize: (raw: unknown) => T): Promise<T> {
  const db = await openDb();
  return normalize(await requestResult<unknown>(db.transaction(FILES).objectStore(FILES).get(key)));
}

/** Reads, changes and writes one shared file in a single transaction, marking it unsynced. */
async function updateFile<T>(key: FileKey, normalize: (raw: unknown) => T, change: (file: T) => T): Promise<T> {
  const db = await openDb();
  const tx = db.transaction([FILES, SYNC], 'readwrite');
  const store = tx.objectStore(FILES);
  let result: T | undefined;
  let changed = false;
  const get = store.get(key);
  get.onsuccess = () => {
    const current = normalize(get.result);
    result = change(current);
    if (deepEqual(result, current)) return;
    changed = true;
    store.put(result, key);
    markDirtyIn(tx, FILE_PATHS[key]);
  };
  await transactionDone(tx);
  if (changed) localChanges.emit(FILE_PATHS[key]);
  return result!;
}

export function getHabits(): Promise<HabitsFile> {
  return getFile('habits', normalizeHabits);
}

/** Reads, changes and writes habits.json in a single transaction. */
export function updateHabits(change: (file: HabitsFile) => HabitsFile): Promise<HabitsFile> {
  return updateFile('habits', normalizeHabits, change);
}

export function getProjects(): Promise<ProjectsFile> {
  return getFile('projects', normalizeProjects);
}

/** Reads, changes and writes projects.json in a single transaction. */
export function updateProjects(change: (file: ProjectsFile) => ProjectsFile): Promise<ProjectsFile> {
  return updateFile('projects', normalizeProjects, change);
}

// ---- Sync bookkeeping ----

/** Reads a synced file's local content inside a transaction; null when it doesn't exist. */
function readLocal(tx: IDBTransaction, file: SyncFile, done: (content: unknown) => void): void {
  const request =
    file.kind === 'day' ? tx.objectStore(DAYS).get(file.date) : tx.objectStore(FILES).get(file.kind);
  request.onsuccess = () => {
    const raw: unknown = request.result;
    if (raw === undefined || raw === null) done(null);
    else if (file.kind === 'day') done(normalizeDay(raw, file.date, nowIso()));
    else if (file.kind === 'habits') done(normalizeHabits(raw));
    else done(normalizeProjects(raw));
  };
}

function writeLocal(tx: IDBTransaction, file: SyncFile, content: unknown): void {
  if (file.kind === 'day') tx.objectStore(DAYS).put(content);
  else tx.objectStore(FILES).put(content, file.kind);
}

function syncFileOf(path: string): SyncFile {
  const file = parseSyncPath(path);
  if (!file) throw new Error('Not a Lifeboard file');
  return file;
}

async function listStates(): Promise<Map<string, FileSyncState>> {
  const db = await openDb();
  const tx = db.transaction([DAYS, FILES, SYNC]);
  const [dayKeys, fileKeys, metaKeys, metas] = await Promise.all([
    requestResult(tx.objectStore(DAYS).getAllKeys()),
    requestResult(tx.objectStore(FILES).getAllKeys()),
    requestResult(tx.objectStore(SYNC).getAllKeys()),
    requestResult(tx.objectStore(SYNC).getAll()),
  ]);
  const metaByPath = new Map(metaKeys.map((key, i) => [String(key), metas[i] as SyncMeta]));
  const paths = [
    ...dayKeys.map((date) => dayPath(String(date))),
    ...fileKeys.filter((k): k is FileKey => k === 'habits' || k === 'projects').map((k) => FILE_PATHS[k]),
  ];
  return new Map(paths.map((path) => [path, fileSyncState(metaByPath.get(path))]));
}

/** This device's data as the sync engine sees it. Each step is a single transaction. */
export const idbSyncStore: SyncStore = {
  listStates,

  async applyRemote(path, remote, sha) {
    const file = syncFileOf(path);
    const db = await openDb();
    const tx = db.transaction([DAYS, FILES, SYNC], 'readwrite');
    const metaStore = tx.objectStore(SYNC);
    let localChanged = false;
    readLocal(tx, file, (local) => {
      const getMeta = metaStore.get(path);
      getMeta.onsuccess = () => {
        // Local content and bookkeeping are read and written together, so an
        // edit can't slip in between the merge and the write.
        const result = resolveRemote(path, local, getMeta.result as SyncMeta | undefined, remote, sha);
        localChanged = result.localChanged;
        if (localChanged) writeLocal(tx, file, result.content);
        metaStore.put(result.meta, path);
      };
    });
    await transactionDone(tx);
    return localChanged;
  },

  async readForPush(path) {
    const file = syncFileOf(path);
    const db = await openDb();
    const tx = db.transaction([DAYS, FILES, SYNC]);
    let item: { content: unknown; sha: string | null; rev: number } | null = null;
    readLocal(tx, file, (content) => {
      const getMeta = tx.objectStore(SYNC).get(path);
      getMeta.onsuccess = () => {
        const meta = getMeta.result as SyncMeta | undefined;
        if (content !== null) item = { content, sha: meta?.sha ?? null, rev: meta?.rev ?? 0 };
      };
    });
    await transactionDone(tx);
    return item;
  },

  async markPushed(path, sha, content, rev) {
    const db = await openDb();
    const tx = db.transaction(SYNC, 'readwrite');
    const store = tx.objectStore(SYNC);
    const get = store.get(path);
    get.onsuccess = () => store.put(afterPush(get.result as SyncMeta | undefined, sha, content, rev), path);
    await transactionDone(tx);
  },
};

/** Number of local files with changes not yet on GitHub. */
export async function countUnsynced(): Promise<number> {
  let count = 0;
  for (const state of (await listStates()).values()) if (state.dirty) count += 1;
  return count;
}

/**
 * Makes sure the sync bookkeeping belongs to `target` ("owner/repo"). When
 * switching to another repo it is reset, so every file counts as never
 * synced there and is merged without assumptions from the old repo.
 */
export async function ensureSyncTarget(target: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SYNC, SETTINGS], 'readwrite');
  const settings = tx.objectStore(SETTINGS);
  const get = settings.get(SYNC_TARGET_KEY);
  get.onsuccess = () => {
    if (get.result === target) return;
    tx.objectStore(SYNC).clear();
    settings.put(target, SYNC_TARGET_KEY);
  };
  await transactionDone(tx);
}

// ---- Sync settings (this device only) ----

/** The stored sync settings. Contains the token: only the sync module should call this. */
export async function getSyncConfig(): Promise<Partial<SyncConfig>> {
  const db = await openDb();
  const raw = await requestResult<unknown>(db.transaction(SETTINGS).objectStore(SETTINGS).get(SYNC_CONFIG_KEY));
  if (!raw || typeof raw !== 'object') return {};
  const { owner, repo, token } = raw as Record<string, unknown>;
  return {
    owner: typeof owner === 'string' ? owner : undefined,
    repo: typeof repo === 'string' ? repo : undefined,
    token: typeof token === 'string' ? token : undefined,
  };
}

/** Changes some sync settings; an empty string removes that setting. */
export async function updateSyncConfig(patch: Partial<SyncConfig>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SETTINGS, 'readwrite');
  const store = tx.objectStore(SETTINGS);
  const get = store.get(SYNC_CONFIG_KEY);
  get.onsuccess = () => {
    const current = (get.result ?? {}) as Partial<SyncConfig>;
    const next: Partial<SyncConfig> = { ...current };
    for (const key of ['owner', 'repo', 'token'] as const) {
      if (patch[key] === undefined) continue;
      if (patch[key]) next[key] = patch[key];
      else delete next[key];
    }
    store.put(next, SYNC_CONFIG_KEY);
  };
  await transactionDone(tx);
}
