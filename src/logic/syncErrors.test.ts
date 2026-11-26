import { describe, expect, it } from 'vitest';
import {
  configProblem,
  isCompleteConfig,
  isValidOwner,
  isValidRepo,
  isValidToken,
  normalizeOwner,
  normalizeRepo,
  syncTarget,
} from './syncConfig';
import { classifyStatus, isPermanentSyncError, retryDelayMs, SyncError, syncErrorMessage, type SyncErrorKind } from './syncErrors';

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';

describe('classifyStatus', () => {
  it('tells apart wrong token, no access, not found and rate limits', () => {
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(403)).toBe('forbidden');
    expect(classifyStatus(403, { rateLimitRemaining: '0' })).toBe('rate-limit');
    expect(classifyStatus(403, { retryAfter: '60' })).toBe('rate-limit');
    expect(classifyStatus(429)).toBe('rate-limit');
    expect(classifyStatus(404)).toBe('not-found');
    expect(classifyStatus(409)).toBe('conflict');
    expect(classifyStatus(502)).toBe('server');
    expect(classifyStatus(418)).toBe('bad-response');
  });
});

describe('sync error messages', () => {
  const kinds: SyncErrorKind[] = [
    'offline',
    'auth',
    'forbidden',
    'not-found',
    'read-only',
    'rate-limit',
    'conflict',
    'server',
    'bad-response',
    'not-configured',
    'local',
  ];

  it('has a clear message for every kind', () => {
    for (const kind of kinds) expect(syncErrorMessage(kind).length).toBeGreaterThan(20);
    expect(new SyncError('auth', 401).message).toMatch(/token/);
    expect(new SyncError('not-found', 404).message).toMatch(/Repo not found/);
    expect(new SyncError('offline').message).toMatch(/offline/);
  });

  it('stops retrying only on errors that need a settings change', () => {
    expect(kinds.filter(isPermanentSyncError)).toEqual(['auth', 'forbidden', 'not-found', 'read-only', 'not-configured']);
  });

  it('backs off between retries', () => {
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([30_000, 120_000, 600_000, 600_000, 600_000]);
  });
});

describe('sync config', () => {
  it('accepts pasted variants of the username and repo', () => {
    expect(normalizeOwner('  @omidiz ')).toBe('omidiz');
    expect(normalizeOwner('https://github.com/omidiz/lifeboard-data')).toBe('omidiz');
    expect(normalizeRepo(' lifeboard-data.git ')).toBe('lifeboard-data');
  });

  it('validates names so they can only ever address a repo on api.github.com', () => {
    expect(isValidOwner('omidiz')).toBe(true);
    expect(isValidOwner('a-b-c')).toBe(true);
    for (const bad of ['', '-x', 'x-', 'a--b', 'a/b', 'evil.com', '..', 'a b', 'x'.repeat(40)]) {
      expect(isValidOwner(bad)).toBe(false);
    }
    expect(isValidRepo('lifeboard-data')).toBe(true);
    expect(isValidRepo('my.data_v2')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a?b', 'a#b', 'a b', '%2e%2e']) expect(isValidRepo(bad)).toBe(false);
  });

  it('validates the token shape without ever needing to show it', () => {
    expect(isValidToken(TOKEN)).toBe(true);
    expect(isValidToken('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(isValidToken('short')).toBe(false);
    expect(isValidToken(`${TOKEN}\nX-Evil: 1`)).toBe(false);
    expect(isValidToken(`Bearer ${TOKEN}`)).toBe(false);
  });

  it('names the first missing or invalid setting', () => {
    expect(configProblem({})).toMatch(/username/);
    expect(configProblem({ owner: 'omidiz' })).toMatch(/repo/);
    expect(configProblem({ owner: 'omidiz', repo: 'lifeboard-data' })).toMatch(/token/);
    expect(configProblem({ owner: 'omidiz', repo: 'lifeboard-data', token: 'nope' })).toMatch(/token/);
    const config = { owner: 'omidiz', repo: 'lifeboard-data', token: TOKEN };
    expect(configProblem(config)).toBeNull();
    expect(isCompleteConfig(config)).toBe(true);
    // The message for a bad token never repeats it.
    expect(configProblem({ ...config, token: 'secret-value' })).not.toContain('secret-value');
  });

  it('identifies the repo case-insensitively', () => {
    expect(syncTarget({ owner: 'Omidiz', repo: 'Lifeboard-Data' })).toBe('omidiz/lifeboard-data');
  });
});
