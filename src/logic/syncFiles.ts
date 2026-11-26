/** The files in the lifeboard-data repo: paths, (de)serialization and merging. */
import { isDateKey } from './dates';
import { normalizeDay } from './day';
import { normalizeHabitsFile } from './habits';
import { isPlainObject } from './json';
import { mergeDay, mergeHabits, mergeProjects } from './merge';
import type { DateKey, DayRecord, HabitsFile, ProjectsFile } from './model';
import { normalizeProjectsFile } from './projects';

export const HABITS_PATH = 'habits.json';
export const PROJECTS_PATH = 'projects.json';

export type SyncFile = { kind: 'day'; date: DateKey } | { kind: 'habits' } | { kind: 'projects' };

const DAY_PATH_RE = /^days\/(\d{4}-\d{2}-\d{2})\.json$/;

export function dayPath(date: DateKey): string {
  return `days/${date}.json`;
}

/** What a repo path holds, or null for files Lifeboard doesn't sync (README, etc.). */
export function parseSyncPath(path: string): SyncFile | null {
  if (path === HABITS_PATH) return { kind: 'habits' };
  if (path === PROJECTS_PATH) return { kind: 'projects' };
  const m = DAY_PATH_RE.exec(path);
  return m && isDateKey(m[1]) ? { kind: 'day', date: m[1] } : null;
}

/** Pretty JSON with a final newline, so the data repo stays readable and diffs stay small. */
export function serializeSyncFile(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

/** Brings content of a file into its current, well-formed shape. */
export function normalizeSyncFile(file: SyncFile, raw: unknown, now: string): DayRecord | HabitsFile | ProjectsFile {
  if (file.kind === 'day') return normalizeDay(raw, file.date, now);
  if (file.kind === 'habits') return normalizeHabitsFile(raw, now);
  return normalizeProjectsFile(raw, now);
}

export type ParsedFile = { ok: true; value: unknown } | { ok: false; reason: string };

/** Parses a file downloaded from the repo; anything unexpected is rejected, never applied. */
export function parseSyncFile(path: string, text: string, now: string): ParsedFile {
  const file = parseSyncPath(path);
  if (!file) return { ok: false, reason: 'not a Lifeboard file' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!isPlainObject(raw)) return { ok: false, reason: 'not a JSON object' };
  if (file.kind === 'day' && raw.date !== undefined && raw.date !== file.date) {
    return { ok: false, reason: 'date does not match the file name' };
  }
  return { ok: true, value: normalizeSyncFile(file, raw, now) };
}

/** Three-way merge of a file's content; `base` is null when never synced. */
export function mergeSyncFile(path: string, base: unknown, local: unknown, remote: unknown): unknown {
  const file = parseSyncPath(path);
  if (!file) throw new Error('Not a Lifeboard file');
  if (file.kind === 'day') return mergeDay(base as DayRecord | null, local as DayRecord, remote as DayRecord);
  if (file.kind === 'habits') return mergeHabits(base as HabitsFile | null, local as HabitsFile, remote as HabitsFile);
  return mergeProjects(base as ProjectsFile | null, local as ProjectsFile, remote as ProjectsFile);
}

// ---------- Base64 (the Contents API sends file content as base64) ----------

/** UTF-8 safe base64, so emoji and accents in notes survive the round trip. */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decodes base64 (GitHub wraps it in newlines) into UTF-8 text; throws on invalid input. */
export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
