import type { FileSyncState } from '../logic/syncState';

export interface RepoInfo {
  defaultBranch: string;
  isPrivate: boolean;
  /** False when GitHub says the token can't write; true when it can or doesn't say. */
  canPush: boolean;
}

export interface RemoteFile {
  text: string;
  sha: string;
}

/** The data repo, as the sync engine sees it. */
export interface RepoClient {
  getRepo(): Promise<RepoInfo>;
  /** Every file on the branch and its blob SHA (empty for an empty repo). */
  listFiles(branch: string): Promise<Map<string, string>>;
  /** null when the file doesn't exist. */
  getFile(path: string): Promise<RemoteFile | null>;
  /**
   * Creates (sha null) or updates (sha of the version being replaced) a file.
   * Throws SyncError 'conflict' when the file changed on GitHub meanwhile.
   */
  putFile(path: string, text: string, sha: string | null, message: string): Promise<{ sha: string }>;
}

/** This device's copy of the data, as the sync engine sees it. */
export interface SyncStore {
  /** Every local file and its sync state. */
  listStates(): Promise<Map<string, FileSyncState>>;
  /**
   * Applies a newer remote version (already parsed and normalized) in one
   * step: takes it, or merges it with local changes. Returns true when the
   * local content changed.
   */
  applyRemote(path: string, remote: unknown, sha: string): Promise<boolean>;
  /** The content to push, with the SHA it replaces and its local revision. */
  readForPush(path: string): Promise<{ content: unknown; sha: string | null; rev: number } | null>;
  /** Records a successful push of `content` (read at `rev`) as `sha`. */
  markPushed(path: string, sha: string, content: unknown, rev: number): Promise<void>;
}
