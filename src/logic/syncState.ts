/**
 * Per-file sync bookkeeping, kept on this device next to the data:
 *   sha   — GitHub's blob SHA of the file at the last sync (null: never synced)
 *   base  — the content at the last sync, the common ancestor for merging
 *   dirty — changed locally since the last sync
 *   rev   — bumped on every local change, so a push that raced with an edit
 *           never marks the newer edit as synced
 */
import { deepEqual } from './json';
import { mergeSyncFile } from './syncFiles';

export interface SyncMeta {
  sha: string | null;
  base: unknown;
  dirty: boolean;
  rev: number;
}

/** What the sync needs to know about a local file. */
export interface FileSyncState {
  sha: string | null;
  dirty: boolean;
}

/** A local file without bookkeeping has never been synced, so it needs pushing. */
export function fileSyncState(meta: SyncMeta | null | undefined): FileSyncState {
  return meta ? { sha: meta.sha, dirty: meta.dirty } : { sha: null, dirty: true };
}

/** After a local change. */
export function markDirty(meta: SyncMeta | null | undefined): SyncMeta {
  return { sha: meta?.sha ?? null, base: meta?.base ?? null, dirty: true, rev: (meta?.rev ?? 0) + 1 };
}

export interface RemoteResolution {
  /** The new local content. */
  content: unknown;
  meta: SyncMeta;
  /** True when the local content changed, so the screens should refresh. */
  localChanged: boolean;
}

/**
 * Combines a newer remote version of a file with the local one:
 *  - nothing local, or no local changes since the last sync: take remote
 *  - local changes: three-way merge; still dirty if the merge has anything
 *    the remote doesn't, so it gets pushed back
 */
export function resolveRemote(
  path: string,
  local: unknown,
  meta: SyncMeta | null | undefined,
  remote: unknown,
  sha: string,
): RemoteResolution {
  const state = fileSyncState(meta);
  let content: unknown;
  if (local === null || local === undefined || !state.dirty) content = remote;
  else content = mergeSyncFile(path, meta?.base ?? null, local, remote);

  const localChanged = !deepEqual(content, local);
  return {
    content,
    meta: {
      sha,
      base: remote,
      dirty: !deepEqual(content, remote),
      rev: (meta?.rev ?? 0) + (localChanged ? 1 : 0),
    },
    localChanged,
  };
}

/**
 * After `pushed` (read at revision `pushedRev`) was saved to GitHub as `sha`.
 * Still dirty if the file changed locally while the push was in flight.
 */
export function afterPush(meta: SyncMeta | null | undefined, sha: string, pushed: unknown, pushedRev: number): SyncMeta {
  const rev = meta?.rev ?? 0;
  return { sha, base: pushed, dirty: rev !== pushedRev, rev };
}
