/**
 * One sync run: pull newer remote files (merging with local changes), then
 * push unsynced local files. Progress is saved file by file, so a run that
 * stops halfway (offline, closed tab) simply continues next time.
 */
import { parseSyncFile, parseSyncPath, serializeSyncFile } from '../logic/syncFiles';
import { SyncError } from '../logic/syncErrors';
import type { RepoClient, SyncStore } from './types';

/** How often a push is retried after a conflict (the file changed on GitHub meanwhile). */
const MAX_PUSH_ATTEMPTS = 3;
/** Downloads in parallel; small, to stay well within GitHub's limits. */
const PULL_CONCURRENCY = 4;

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** Remote files that couldn't be read and were left alone (local copies are kept as they are). */
  skipped: string[];
  /** Local files that changed because of remote changes. */
  changedLocally: string[];
}

export interface SyncOptions {
  now?: () => string;
  /** Called as soon as a local file changes because of a remote change. */
  onLocalChange?: (path: string) => void;
  /** Runs once the repo is known to exist and be writable, before any file is touched. */
  onRepoVerified?: () => Promise<void>;
}

async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function runSync(store: SyncStore, client: RepoClient, options: SyncOptions = {}): Promise<SyncReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const report: SyncReport = { pulled: 0, pushed: 0, skipped: [], changedLocally: [] };
  const skipped = new Set<string>();

  const repo = await client.getRepo();
  if (!repo.canPush) throw new SyncError('read-only');
  await options.onRepoVerified?.();

  /** Downloads a file and applies it locally. Returns false if it doesn't exist (anymore). */
  async function pull(path: string): Promise<boolean> {
    const file = await client.getFile(path);
    if (!file) return false;
    const parsed = parseSyncFile(path, file.text, now());
    if (!parsed.ok) {
      // Never let a broken remote file touch local data, and don't overwrite it either.
      skipped.add(path);
      return true;
    }
    if (await store.applyRemote(path, parsed.value, file.sha)) {
      report.changedLocally.push(path);
      options.onLocalChange?.(path);
    }
    report.pulled += 1;
    return true;
  }

  // ---- Pull ----
  const remote = await client.listFiles(repo.defaultBranch);
  const states = await store.listStates();
  const toPull = [...remote].filter(([path, sha]) => parseSyncPath(path) && states.get(path)?.sha !== sha).map(([path]) => path);
  await eachLimited(toPull, PULL_CONCURRENCY, async (path) => {
    await pull(path);
  });

  // ---- Push ----
  const dirty = [...(await store.listStates())]
    .filter(([path, state]) => state.dirty && !skipped.has(path) && parseSyncPath(path))
    .map(([path]) => path)
    .sort();

  for (const path of dirty) {
    // Not on GitHub (new, or deleted there): create it rather than update.
    let missingRemotely = !remote.has(path);
    for (let attempt = 1; ; attempt++) {
      const item = await store.readForPush(path);
      if (!item) break;
      try {
        const { sha } = await client.putFile(
          path,
          serializeSyncFile(item.content),
          missingRemotely ? null : item.sha,
          `Sync ${path}`,
        );
        await store.markPushed(path, sha, item.content, item.rev);
        report.pushed += 1;
        break;
      } catch (error) {
        if (!(error instanceof SyncError) || error.kind !== 'conflict' || attempt >= MAX_PUSH_ATTEMPTS) throw error;
        // Someone else pushed this file meanwhile: merge their version in, then try again.
        missingRemotely = !(await pull(path));
        if (skipped.has(path)) break;
      }
    }
  }

  report.skipped = [...skipped].sort();
  return report;
}
