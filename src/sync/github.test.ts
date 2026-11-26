import { describe, expect, it } from 'vitest';
import { encodeBase64Utf8 } from '../logic/syncFiles';
import { SyncError } from '../logic/syncErrors';
import { createGitHubClient, type FetchLike } from './github';

const TOKEN = 'github_pat_11SECRET0000000000_doNotLeakThisTokenAnywhere123';
const config = { owner: 'omidiz', repo: 'lifeboard-data', token: TOKEN };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchFn };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function caught(promise: Promise<unknown>): Promise<SyncError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SyncError);
    return error as SyncError;
  }
  throw new Error('Expected the call to fail');
}

describe('GitHub client: where the token goes', () => {
  it('sends the token only in the Authorization header, only to api.github.com', async () => {
    const { calls, fetchFn } = fakeFetch(() => jsonResponse(200, { default_branch: 'main', private: true }));
    await createGitHubClient(config, fetchFn).getRepo();
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(new URL(url).origin).toBe('https://api.github.com');
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
  });

  it('refuses names that could point the request elsewhere', () => {
    for (const bad of [
      { ...config, owner: 'evil.com' },
      { ...config, repo: '../../x' },
      { ...config, owner: 'a/b' },
      { ...config, token: `${TOKEN}\r\nX: y` },
    ]) {
      expect(() => createGitHubClient(bad, async () => jsonResponse(200, {}))).toThrow(SyncError);
    }
  });

  it('never includes the token in any error', async () => {
    const statuses = [400, 401, 403, 404, 409, 422, 429, 500, 503];
    for (const status of statuses) {
      const client = createGitHubClient(config, async () =>
        jsonResponse(status, { message: `Bad credentials for ${TOKEN}` }),
      );
      const calls: (() => Promise<unknown>)[] = [() => client.getRepo(), () => client.putFile('habits.json', '{}', null, 'm')];
      // A missing file isn't an error for getFile, it returns null.
      if (status !== 404) calls.push(() => client.getFile('habits.json'));
      for (const call of calls) {
        const error = await caught(call());
        expect(error.message).not.toContain(TOKEN);
        expect(String(error)).not.toContain(TOKEN);
        expect(JSON.stringify(error)).not.toContain(TOKEN);
      }
    }
    const offline = await caught(
      createGitHubClient(config, async () => {
        throw new TypeError(`Failed to fetch with ${TOKEN}`);
      }).getRepo(),
    );
    expect(offline.kind).toBe('offline');
    expect(offline.message).not.toContain(TOKEN);
  });
});

describe('GitHub client: test connection errors', () => {
  const kindFor = async (status: number, headers: Record<string, string> = {}) =>
    (await caught(createGitHubClient(config, async () => jsonResponse(status, {}, headers)).getRepo())).kind;

  it('distinguishes wrong token, no access, repo not found, rate limit and offline', async () => {
    expect(await kindFor(401)).toBe('auth');
    expect(await kindFor(403)).toBe('forbidden');
    expect(await kindFor(403, { 'x-ratelimit-remaining': '0' })).toBe('rate-limit');
    expect(await kindFor(404)).toBe('not-found');
    expect(await kindFor(500)).toBe('server');
    const offline = await caught(
      createGitHubClient(config, async () => {
        throw new TypeError('Failed to fetch');
      }).getRepo(),
    );
    expect(offline.kind).toBe('offline');
  });

  it('reports repo details', async () => {
    const client = createGitHubClient(config, async () =>
      jsonResponse(200, { default_branch: 'trunk', private: false, permissions: { push: false, pull: true } }),
    );
    expect(await client.getRepo()).toEqual({ defaultBranch: 'trunk', isPrivate: false, canPush: false });
  });

  it('fails cleanly on a response that isn’t JSON', async () => {
    const client = createGitHubClient(config, async () => new Response('<html>', { status: 200 }));
    expect((await caught(client.getRepo())).kind).toBe('bad-response');
  });
});

describe('GitHub client: files', () => {
  it('lists blobs with their SHAs', async () => {
    const { calls, fetchFn } = fakeFetch(() =>
      jsonResponse(200, {
        tree: [
          { path: 'days', type: 'tree', sha: 't1' },
          { path: 'days/2026-11-26.json', type: 'blob', sha: 'b1' },
          { path: 'habits.json', type: 'blob', sha: 'b2' },
        ],
      }),
    );
    const files = await createGitHubClient(config, fetchFn).listFiles('main');
    expect([...files]).toEqual([
      ['days/2026-11-26.json', 'b1'],
      ['habits.json', 'b2'],
    ]);
    expect(calls[0].url).toBe('https://api.github.com/repos/omidiz/lifeboard-data/git/trees/main?recursive=1');
  });

  it('treats an empty repo as having no files', async () => {
    const client = createGitHubClient(config, async () => jsonResponse(409, { message: 'Git Repository is empty.' }));
    expect((await client.listFiles('main')).size).toBe(0);
  });

  it('downloads and decodes a file', async () => {
    const text = '{"note":"Café 🌱"}\n';
    const { calls, fetchFn } = fakeFetch(() =>
      jsonResponse(200, { type: 'file', sha: 'abc', content: encodeBase64Utf8(text).replace(/(.{8})/g, '$1\n') }),
    );
    expect(await createGitHubClient(config, fetchFn).getFile('days/2026-11-26.json')).toEqual({ text, sha: 'abc' });
    expect(calls[0].url).toBe('https://api.github.com/repos/omidiz/lifeboard-data/contents/days/2026-11-26.json');
  });

  it('returns null for a missing file', async () => {
    expect(await createGitHubClient(config, async () => jsonResponse(404, {})).getFile('habits.json')).toBeNull();
  });

  it('uploads with the SHA it replaces', async () => {
    const { calls, fetchFn } = fakeFetch(() => jsonResponse(200, { content: { sha: 'new' } }));
    const client = createGitHubClient(config, fetchFn);
    expect(await client.putFile('habits.json', '{}\n', 'old', 'Sync habits.json')).toEqual({ sha: 'new' });
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: 'Sync habits.json',
      content: encodeBase64Utf8('{}\n'),
      sha: 'old',
    });
    await client.putFile('projects.json', '{}\n', null, 'm');
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty('sha');
  });

  it('reports a stale SHA as a conflict', async () => {
    for (const status of [409, 422]) {
      const client = createGitHubClient(config, async () => jsonResponse(status, {}));
      expect((await caught(client.putFile('habits.json', '{}', 'old', 'm'))).kind).toBe('conflict');
    }
  });
});
