/**
 * GitHub REST client for the data repo. This is the only code that uses the
 * token. It is sent only in the Authorization header, only to
 * https://api.github.com (the host is fixed and names are validated), and
 * never appears in URLs, errors or logs.
 */
import { decodeBase64Utf8, encodeBase64Utf8 } from '../logic/syncFiles';
import { isValidOwner, isValidRepo, isValidToken, type SyncConfig } from '../logic/syncConfig';
import { classifyStatus, SyncError } from '../logic/syncErrors';
import type { RemoteFile, RepoClient, RepoInfo } from './types';

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function createGitHubClient(config: SyncConfig, fetchFn: FetchLike = (url, init) => fetch(url, init)): RepoClient {
  if (!isValidOwner(config.owner) || !isValidRepo(config.repo) || !isValidToken(config.token)) {
    throw new SyncError('not-configured');
  }
  const repoPath = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;

  async function request(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<Response> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SyncError('offline');
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await fetchFn(API + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Always fresh: a cached listing would make every push look like a conflict.
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      });
    } catch {
      // Network failure or timeout. The original error is dropped on purpose.
      throw new SyncError('offline');
    }
  }

  function fail(response: Response): never {
    throw new SyncError(
      classifyStatus(response.status, {
        rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
        retryAfter: response.headers.get('retry-after'),
      }),
      response.status,
    );
  }

  async function json(response: Response): Promise<Record<string, unknown>> {
    try {
      const data: unknown = await response.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
    } catch {
      // fall through
    }
    throw new SyncError('bad-response', response.status);
  }

  return {
    async getRepo(): Promise<RepoInfo> {
      const response = await request('GET', repoPath);
      if (!response.ok) fail(response);
      const data = await json(response);
      const permissions = data.permissions as { push?: unknown } | undefined;
      return {
        defaultBranch: typeof data.default_branch === 'string' && data.default_branch ? data.default_branch : 'main',
        isPrivate: data.private === true,
        canPush: permissions?.push !== false,
      };
    },

    async listFiles(branch: string): Promise<Map<string, string>> {
      const response = await request('GET', `${repoPath}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      // An empty repo has no branch yet: 409 "Git Repository is empty" (or 404).
      if (response.status === 409 || response.status === 404) return new Map();
      if (!response.ok) fail(response);
      const data = await json(response);
      if (!Array.isArray(data.tree)) throw new SyncError('bad-response', response.status);
      const files = new Map<string, string>();
      for (const entry of data.tree as { path?: unknown; sha?: unknown; type?: unknown }[]) {
        if (entry.type === 'blob' && typeof entry.path === 'string' && typeof entry.sha === 'string') {
          files.set(entry.path, entry.sha);
        }
      }
      return files;
    },

    async getFile(path: string): Promise<RemoteFile | null> {
      const response = await request('GET', `${repoPath}/contents/${encodePath(path)}`);
      if (response.status === 404) return null;
      if (!response.ok) fail(response);
      const data = await json(response);
      if (data.type !== 'file' || typeof data.sha !== 'string' || typeof data.content !== 'string') {
        throw new SyncError('bad-response', response.status);
      }
      try {
        return { text: decodeBase64Utf8(data.content), sha: data.sha };
      } catch {
        throw new SyncError('bad-response', response.status);
      }
    },

    async putFile(path: string, text: string, sha: string | null, message: string): Promise<{ sha: string }> {
      const body: Record<string, string> = { message, content: encodeBase64Utf8(text) };
      if (sha) body.sha = sha;
      const response = await request('PUT', `${repoPath}/contents/${encodePath(path)}`, body);
      // 409: the SHA is stale. 422: no SHA given for a file that exists (or one given for a file that doesn't).
      if (response.status === 409 || response.status === 422) throw new SyncError('conflict', response.status);
      if (!response.ok) fail(response);
      const data = await json(response);
      const content = data.content as { sha?: unknown } | undefined;
      if (typeof content?.sha !== 'string') throw new SyncError('bad-response', response.status);
      return { sha: content.sha };
    },
  };
}
