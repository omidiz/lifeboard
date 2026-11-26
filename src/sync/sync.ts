/**
 * When to sync, and the sync status the screens show.
 *
 * Syncs on app open, a few seconds after the last change, when the device
 * comes back online, and when the app returns to the foreground (at most
 * once a minute). Only one tab syncs at a time. Temporary errors retry with
 * backoff; errors that need a settings change (wrong token, no access, repo
 * not found) wait until the settings change.
 *
 * The token stays inside this module and the GitHub client: nothing here
 * returns, logs or displays it.
 */
import { localChanges, remoteChanges } from '../data/changes';
import { countUnsynced, ensureSyncTarget, getSyncConfig, idbSyncStore, updateSyncConfig } from '../data/db';
import {
  configProblem,
  DEFAULT_REPO,
  isCompleteConfig,
  normalizeOwner,
  normalizeRepo,
  normalizeToken,
  syncTarget,
  tokenProblem,
  type SyncConfig,
} from '../logic/syncConfig';
import { isPermanentSyncError, retryDelayMs, SyncError, syncErrorMessage, type SyncErrorKind } from '../logic/syncErrors';
import { INITIAL_SYNC_STATUS, type SyncStatus } from '../logic/syncStatus';
import { runSync } from './engine';
import { createGitHubClient } from './github';

const CHANGE_DEBOUNCE_MS = 4_000;
const FOREGROUND_MIN_INTERVAL_MS = 60_000;
const LAST_SYNC_KEY = 'lifeboard.lastSyncAt';

export type SyncReason = 'open' | 'change' | 'online' | 'foreground' | 'manual' | 'settings';

// ---------- Status ----------

let status: SyncStatus = { ...INITIAL_SYNC_STATUS, lastSyncAt: readLastSync() };
const statusListeners = new Set<(status: SyncStatus) => void>();

function readLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener(status));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

async function refreshUnsynced(): Promise<void> {
  try {
    const unsynced = await countUnsynced();
    if (unsynced !== status.unsynced) setStatus({ unsynced });
  } catch {
    // Storage unavailable; the count just stays as it was.
  }
}

// ---------- Scheduling ----------

let running: Promise<void> | null = null;
let rerun = false;
let changedDuringRun = false;
let debounceTimer: number | undefined;
let retryTimer: number | undefined;
let retryAttempt = 0;
/** Set after an error that needs a settings change; automatic triggers wait until then. */
let blocked = false;
let lastAttemptAt = 0;
let started = false;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function withSyncLock(run: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // Two tabs syncing the same files at once would only cause needless conflicts.
  return locks ? locks.request('lifeboard-sync', run) : run();
}

export function requestSync(reason: SyncReason): Promise<void> {
  if (blocked && (reason === 'change' || reason === 'online' || reason === 'foreground')) return refreshUnsynced();
  if (reason === 'foreground' && Date.now() - lastAttemptAt < FOREGROUND_MIN_INTERVAL_MS) return Promise.resolve();
  if (reason === 'settings' || reason === 'manual') {
    blocked = false;
    retryAttempt = 0;
  }
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await syncOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

function onLocalChange(): void {
  changedDuringRun = true;
  void refreshUnsynced();
  if (status.state === 'off') return;
  if (!blocked && !isOffline()) setStatus({ state: 'syncing', message: null });
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void requestSync('change'), CHANGE_DEBOUNCE_MS);
}

function scheduleRetry(): void {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void requestSync('change'), retryDelayMs(retryAttempt));
  retryAttempt += 1;
}

async function syncOnce(): Promise<void> {
  window.clearTimeout(debounceTimer);
  window.clearTimeout(retryTimer);
  lastAttemptAt = Date.now();
  changedDuringRun = false;

  let config: Partial<SyncConfig>;
  try {
    config = await getSyncConfig();
  } catch {
    setStatus({ state: 'error', message: syncErrorMessage('local') });
    return;
  }
  if (!isCompleteConfig(config)) {
    setStatus({ state: 'off', message: null });
    return;
  }
  if (isOffline()) {
    setStatus({ state: 'offline', message: syncErrorMessage('offline') });
    await refreshUnsynced();
    return;
  }

  setStatus({ state: 'syncing', message: null });
  const changed = new Set<string>();
  try {
    let skipped: string[] = [];
    await withSyncLock(async () => {
      const report = await runSync(idbSyncStore, createGitHubClient(config), {
        onLocalChange: (path) => changed.add(path),
        // Only a repo that was actually reached counts as switching repos, so a
        // half-typed repo name never resets what this device knows about the real one.
        onRepoVerified: () => ensureSyncTarget(syncTarget(config)),
      });
      skipped = report.skipped;
    });
    blocked = false;
    retryAttempt = 0;
    const lastSyncAt = new Date().toISOString();
    try {
      localStorage.setItem(LAST_SYNC_KEY, lastSyncAt);
    } catch {
      // Only used for display.
    }
    if (skipped.length > 0) {
      const files = skipped.length === 1 ? `${skipped[0]} in the repo isn’t` : `${skipped.length} files in the repo aren’t`;
      setStatus({
        state: 'error',
        lastSyncAt,
        message: `${files} valid Lifeboard data, so ${skipped.length === 1 ? 'it was' : 'they were'} left alone. Fix or delete ${skipped.length === 1 ? 'it' : 'them'} on GitHub.`,
      });
    } else {
      setStatus({ state: changedDuringRun ? 'syncing' : 'synced', message: null, lastSyncAt });
    }
  } catch (error) {
    const kind: SyncErrorKind = error instanceof SyncError ? error.kind : 'local';
    const httpStatus = error instanceof SyncError ? error.status : null;
    // Only the kind is logged: never the error object, which could carry request details.
    console.warn(`Lifeboard sync failed: ${kind}${httpStatus ? ` (${httpStatus})` : ''}`);
    setStatus({ state: kind === 'offline' ? 'offline' : 'error', message: syncErrorMessage(kind, httpStatus) });
    if (isPermanentSyncError(kind)) blocked = true;
    else if (kind !== 'offline' || !isOffline()) scheduleRetry(); // truly offline: the 'online' event resumes
  } finally {
    changed.forEach((path) => remoteChanges.emit(path));
    await refreshUnsynced();
  }
}

/** Starts syncing: on open, after changes, when back online and back in the foreground. */
export function initSync(): void {
  if (started) return;
  started = true;
  localChanges.on(onLocalChange);
  window.addEventListener('online', () => void requestSync('online'));
  window.addEventListener('offline', () => {
    if (status.state !== 'off') setStatus({ state: 'offline', message: syncErrorMessage('offline') });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void requestSync('foreground');
  });
  void refreshUnsynced();
  void requestSync('open');
}

// ---------- Settings ----------

/** What Settings may know about the config: never the token itself. */
export interface PublicSyncSettings {
  owner: string;
  repo: string;
  hasToken: boolean;
}

export async function getSyncSettings(): Promise<PublicSyncSettings> {
  const config = await getSyncConfig();
  return { owner: config.owner ?? '', repo: config.repo ?? '', hasToken: !!config.token };
}

/** Saves the username and repo (cleaned up); returns the saved values. */
export async function saveRepoSettings(input: { owner: string; repo: string }): Promise<{ owner: string; repo: string }> {
  const owner = normalizeOwner(input.owner);
  const repo = normalizeRepo(input.repo) || DEFAULT_REPO;
  await updateSyncConfig({ owner, repo });
  void requestSync('settings');
  return { owner, repo };
}

/** Saves a new token. Returns a problem to show, or null when saved. */
export async function saveToken(input: string): Promise<string | null> {
  const token = normalizeToken(input);
  const problem = tokenProblem(token);
  if (problem) return problem;
  await updateSyncConfig({ token });
  void requestSync('settings');
  return null;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

/** Checks the saved settings against GitHub, with a clear message either way. */
export async function testConnection(): Promise<ConnectionResult> {
  const config = await getSyncConfig();
  const problem = configProblem(config);
  if (problem || !isCompleteConfig(config)) return { ok: false, message: problem ?? syncErrorMessage('not-configured') };
  try {
    const repo = await createGitHubClient(config).getRepo();
    if (!repo.canPush) return { ok: false, message: syncErrorMessage('read-only') };
    void requestSync('settings');
    const name = `${config.owner}/${config.repo}`;
    return repo.isPrivate
      ? { ok: true, message: `Connected to ${name}. Sync is on.` }
      : {
          ok: true,
          message: `Connected to ${name}, but this repo is public: anyone can read your data. Make it private in the repo’s settings on GitHub.`,
        };
  } catch (error) {
    const kind: SyncErrorKind = error instanceof SyncError ? error.kind : 'bad-response';
    return { ok: false, message: syncErrorMessage(kind, error instanceof SyncError ? error.status : null) };
  }
}

/** Removes the token from this device. Local data and the username/repo stay. */
export async function disconnect(): Promise<void> {
  await updateSyncConfig({ token: '' });
  window.clearTimeout(debounceTimer);
  window.clearTimeout(retryTimer);
  blocked = false;
  retryAttempt = 0;
  setStatus({ state: 'off', message: null });
}
