/**
 * Local storage on IndexedDB. Every change is written here first; sync to
 * the lifeboard-data repo will read from these stores later.
 *
 * Stores:
 *   days  — one DayRecord per date (keyPath "date"), like days/YYYY-MM-DD.json
 *   files — the shared files, keyed "habits" and "projects"
 */
import { emptyDay } from '../logic/day';
import { ticksByHabit } from '../logic/habits';
import type { CheckIn, DateKey, DayRecord, HabitsFile, ProjectsFile } from '../logic/model';

const DB_NAME = 'lifeboard';
const DB_VERSION = 1;
const DAYS = 'days';
const FILES = 'files';

type FileKey = 'habits' | 'projects';

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

/** Fills in fields missing from records written by older versions. */
function normalizeDay(raw: Partial<DayRecord>, date: DateKey): DayRecord {
  return { ...emptyDay(date, raw.updatedAt ?? nowIso()), ...raw, date };
}

// ---- Days ----

export async function getDay(date: DateKey): Promise<DayRecord | null> {
  const db = await openDb();
  const raw = await requestResult<Partial<DayRecord> | undefined>(
    db.transaction(DAYS).objectStore(DAYS).get(date),
  );
  return raw ? normalizeDay(raw, date) : null;
}

export async function putDay(day: DayRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DAYS, 'readwrite');
  tx.objectStore(DAYS).put(day);
  await transactionDone(tx);
}

/**
 * Reads, changes and writes a day in a single transaction, so quick
 * successive edits (e.g. tapping +15 min repeatedly) never overwrite
 * each other.
 */
export async function updateDay(date: DateKey, change: (day: DayRecord) => DayRecord): Promise<DayRecord> {
  const db = await openDb();
  const tx = db.transaction(DAYS, 'readwrite');
  const store = tx.objectStore(DAYS);
  let result: DayRecord | undefined;
  const get = store.get(date);
  get.onsuccess = () => {
    const raw = get.result as Partial<DayRecord> | undefined;
    const current = raw ? normalizeDay(raw, date) : emptyDay(date, nowIso());
    result = { ...change(current), date };
    store.put(result);
  };
  await transactionDone(tx);
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
      const day = cursor.value as Partial<DayRecord>;
      if (day.checkIn) resolve(day.checkIn);
      else cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

/** All days in [from, to], inclusive, in date order. */
export async function getDaysInRange(from: DateKey, to: DateKey): Promise<DayRecord[]> {
  const db = await openDb();
  const raws = await requestResult<Partial<DayRecord>[]>(
    db.transaction(DAYS).objectStore(DAYS).getAll(IDBKeyRange.bound(from, to)),
  );
  return raws.map((raw) => normalizeDay(raw, raw.date!));
}

/** Every date each habit was ticked on, by habit id. */
export async function getAllHabitTicks(): Promise<Map<string, Set<DateKey>>> {
  const db = await openDb();
  const days = await requestResult<Partial<DayRecord>[]>(db.transaction(DAYS).objectStore(DAYS).getAll());
  return ticksByHabit(days.map((d) => ({ date: d.date!, habitTicks: d.habitTicks ?? [] })));
}

// ---- Habits & projects ----

async function getFile<T>(key: FileKey): Promise<T | undefined> {
  const db = await openDb();
  return requestResult<T | undefined>(db.transaction(FILES).objectStore(FILES).get(key));
}

async function putFile<T>(key: FileKey, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(FILES, 'readwrite');
  tx.objectStore(FILES).put(value, key);
  await transactionDone(tx);
}

export async function getHabits(): Promise<HabitsFile> {
  const file = await getFile<HabitsFile>('habits');
  return { habits: [], updatedAt: nowIso(), ...file };
}

export function putHabits(file: HabitsFile): Promise<void> {
  return putFile('habits', file);
}

/** Reads, changes and writes habits.json in a single transaction. */
export async function updateHabits(change: (file: HabitsFile) => HabitsFile): Promise<HabitsFile> {
  const db = await openDb();
  const tx = db.transaction(FILES, 'readwrite');
  const store = tx.objectStore(FILES);
  let result: HabitsFile | undefined;
  const get = store.get('habits');
  get.onsuccess = () => {
    const current: HabitsFile = { habits: [], updatedAt: nowIso(), ...(get.result as HabitsFile | undefined) };
    result = change(current);
    store.put(result, 'habits');
  };
  await transactionDone(tx);
  return result!;
}

export async function getProjects(): Promise<ProjectsFile> {
  const file = await getFile<ProjectsFile>('projects');
  return { projects: [], weeklyGoals: [], updatedAt: nowIso(), ...file };
}

export function putProjects(file: ProjectsFile): Promise<void> {
  return putFile('projects', file);
}
