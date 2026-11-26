/**
 * Test doubles for the sync engine: a device's local data in memory, and a
 * fake GitHub repo. Only imported by tests.
 */
import { deepEqual } from '../logic/json';
import { afterPush, fileSyncState, markDirty, resolveRemote, type SyncMeta } from '../logic/syncState';
import { SyncError } from '../logic/syncErrors';
import type { RemoteFile, RepoClient, RepoInfo, SyncStore } from './types';

/** One device: its files and its sync bookkeeping. */
export class MemoryStore implements SyncStore {
  readonly files = new Map<string, unknown>();
  readonly meta = new Map<string, SyncMeta>();

  /** A local change, as the app makes it: save the content and mark it unsynced. */
  edit<T>(path: string, change: (current: T | undefined) => T): T {
    const current = this.files.get(path) as T | undefined;
    const next = change(current);
    if (current !== undefined && deepEqual(current, next)) return next;
    this.files.set(path, structuredClone(next));
    this.meta.set(path, markDirty(this.meta.get(path)));
    return next;
  }

  read<T>(path: string): T | undefined {
    return this.files.get(path) as T | undefined;
  }

  unsynced(): string[] {
    return [...this.files.keys()].filter((p) => fileSyncState(this.meta.get(p)).dirty).sort();
  }

  async listStates() {
    return new Map([...this.files.keys()].map((p) => [p, fileSyncState(this.meta.get(p))]));
  }

  async applyRemote(path: string, remote: unknown, sha: string) {
    const r = resolveRemote(path, this.files.get(path) ?? null, this.meta.get(path), remote, sha);
    this.files.set(path, structuredClone(r.content));
    this.meta.set(path, r.meta);
    return r.localChanged;
  }

  async readForPush(path: string) {
    const content = this.files.get(path);
    if (content === undefined) return null;
    const meta = this.meta.get(path);
    return { content: structuredClone(content), sha: meta?.sha ?? null, rev: meta?.rev ?? 0 };
  }

  async markPushed(path: string, sha: string, content: unknown, rev: number) {
    this.meta.set(path, afterPush(this.meta.get(path), sha, content, rev));
  }
}

/** A GitHub repo in memory, enforcing SHAs on update like the Contents API. */
export class FakeRepo {
  readonly files = new Map<string, RemoteFile>();
  info: RepoInfo = { defaultBranch: 'main', isPrivate: true, canPush: true };
  commits = 0;
  private nextSha = 1;
  /** Called before a PUT is applied: lets a test sneak in another device's push. */
  beforePut: ((path: string) => void | Promise<void>) | null = null;
  /** Throws for the next requests, e.g. to go offline mid-sync. */
  failWith: SyncError | null = null;

  /** Writes a file directly, as another device or a person editing on github.com would. */
  write(path: string, text: string): string {
    const sha = `sha${this.nextSha++}`;
    this.files.set(path, { text, sha });
    this.commits += 1;
    return sha;
  }

  json<T>(path: string): T | undefined {
    const file = this.files.get(path);
    return file ? (JSON.parse(file.text) as T) : undefined;
  }

  client(): RepoClient {
    const check = () => {
      if (this.failWith) throw this.failWith;
    };
    return {
      getRepo: async () => (check(), { ...this.info }),
      listFiles: async () => (check(), new Map([...this.files].map(([p, f]) => [p, f.sha]))),
      getFile: async (path) => {
        check();
        const file = this.files.get(path);
        return file ? { ...file } : null;
      },
      putFile: async (path, text, sha) => {
        check();
        await this.beforePut?.(path);
        const current = this.files.get(path);
        if ((current?.sha ?? null) !== sha) throw new SyncError('conflict', current ? 409 : 422);
        return { sha: this.write(path, text) };
      },
    };
  }
}
